import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { streamUrl, coverArtUrl } from '../api/subsonic';
import * as offlineDb from '../lib/offlineDb';
import type { RetainTag } from '../lib/offlineDb';
import type { Song, Playlist } from '../api/types';
import { useToastStore } from './toast';

export type DownloadTarget = 'ask' | 'app' | 'device';
type ItemState = 'downloading' | 'downloaded';
type ResolvedTarget = 'app' | 'device';

export interface PendingDownloadRequest {
  kind: 'track' | 'playlist' | 'album';
  song?: Song;
  playlist?: Playlist;
  songs?: Song[]; // for kind: 'playlist' | 'album'
}

interface DownloadsState {
  status: Record<string, ItemState>; // keyed 't:{trackId}' / 'p:{playlistId}'
  errors: Record<string, string>;
  defaultTarget: DownloadTarget;
  pendingRequest: PendingDownloadRequest | null;

  setDefaultTarget: (target: DownloadTarget) => void;

  hydrate: () => Promise<void>;
  trackState: (id: string) => ItemState | undefined;
  playlistState: (id: string) => ItemState | undefined;

  /** Entry point for "Download" actions in the UI — resolves the target (asking if needed). */
  requestDownload: (req: PendingDownloadRequest) => void;
  resolvePendingRequest: (target: ResolvedTarget, remember: boolean) => Promise<void>;
  cancelPendingRequest: () => void;

  downloadTrack: (song: Song, tag?: RetainTag) => Promise<void>;
  removeTrackDownload: (trackId: string) => Promise<void>;

  downloadPlaylist: (playlist: Playlist, songs: Song[]) => Promise<void>;
  removePlaylistDownload: (playlistId: string) => Promise<void>;
  /**
   * Brings a downloaded playlist up to date with the server's copy: tracks
   * added since are downloaded, removed ones released. No-op for a playlist
   * that isn't downloaded.
   */
  syncPlaylistDownload: (playlist: Playlist, songs: Song[]) => Promise<void>;

  saveToDevice: (song: Song) => Promise<void>;
}

async function fetchBlob(url: string): Promise<{ blob: Blob; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const blob = await res.blob();
  return { blob, mimeType: res.headers.get('content-type') ?? 'application/octet-stream' };
}

/** Fetch a track's audio (and best-effort cover art) and persist it offline under `tag`. */
async function fetchAndSaveTrack(song: Song, tag: RetainTag): Promise<void> {
  const { blob, mimeType } = await fetchBlob(streamUrl(song.id));
  if (song.coverArt) {
    try {
      const cover = await fetchBlob(coverArtUrl(song.coverArt, 600));
      await offlineDb.saveCoverBlob(song.coverArt, cover.blob, cover.mimeType);
    } catch {
      // Cover art is best-effort — a missing cover shouldn't fail the download.
    }
  }
  await offlineDb.saveTrack(song, blob, mimeType, tag);
}

async function performRequest(
  get: () => DownloadsState,
  req: PendingDownloadRequest,
  target: ResolvedTarget,
): Promise<void> {
  if (target === 'device') {
    try {
      if (req.kind === 'track' && req.song) await get().saveToDevice(req.song);
      if ((req.kind === 'playlist' || req.kind === 'album') && req.songs) {
        for (const song of req.songs) await get().saveToDevice(song);
      }
    } catch (e) {
      useToastStore.getState().show(e instanceof Error ? e.message : 'Download failed');
    }
    return;
  }
  if (req.kind === 'track' && req.song) await get().downloadTrack(req.song);
  if (req.kind === 'album' && req.songs) {
    // Unlike kind: 'playlist', an album isn't its own offline entity (no
    // savePlaylist-style record, no album-level "downloaded" badge) — this
    // just downloads each track individually, same as clicking Download on
    // every row, so it plugs into the exact same tested retain/dedup path.
    for (const song of req.songs) await get().downloadTrack(song);
  }
  if (req.kind === 'playlist' && req.playlist && req.songs) {
    await get().downloadPlaylist(req.playlist, req.songs);
  }
}

const syncingPlaylists = new Set<string>();

export const useDownloadsStore = create<DownloadsState>()(
  persist(
    (set, get) => ({
      status: {},
      errors: {},
      defaultTarget: 'ask',
      pendingRequest: null,

      setDefaultTarget: (target) => set({ defaultTarget: target }),

      requestDownload: (req) => {
        const { defaultTarget } = get();
        if (defaultTarget === 'ask') {
          set({ pendingRequest: req });
          return;
        }
        void performRequest(get, req, defaultTarget);
      },

      resolvePendingRequest: async (target, remember) => {
        const req = get().pendingRequest;
        set({ pendingRequest: null });
        if (!req) return;
        if (remember) set({ defaultTarget: target });
        await performRequest(get, req, target);
      },

      cancelPendingRequest: () => set({ pendingRequest: null }),

      hydrate: async () => {
        await offlineDb.reconcileEvictedTracks();
        const [trackIds, playlists] = await Promise.all([
          offlineDb.getDownloadedTrackIds(),
          offlineDb.getAllDownloadedPlaylists(),
        ]);
        const status: Record<string, ItemState> = {};
        for (const id of trackIds) status[`t:${id}`] = 'downloaded';
        for (const pl of playlists) status[`p:${pl.id}`] = 'downloaded';
        set({ status });
      },

      trackState: (id) => get().status[`t:${id}`],
      playlistState: (id) => get().status[`p:${id}`],

      downloadTrack: async (song, tag = 'individual') => {
        const key = `t:${song.id}`;
        set((s) => ({ status: { ...s.status, [key]: 'downloading' }, errors: { ...s.errors, [key]: '' } }));
        try {
          await fetchAndSaveTrack(song, tag);
          set((s) => ({ status: { ...s.status, [key]: 'downloaded' } }));
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Download failed';
          set((s) => {
            const status = { ...s.status };
            delete status[key];
            return { status, errors: { ...s.errors, [key]: message } };
          });
          useToastStore.getState().show(`Couldn't download "${song.title}": ${message}`);
        }
      },

      removeTrackDownload: async (trackId) => {
        await offlineDb.releaseTrack(trackId, 'individual' as RetainTag);
        const stillDownloaded = await offlineDb.isTrackDownloaded(trackId);
        set((s) => {
          const status = { ...s.status };
          const key = `t:${trackId}`;
          if (stillDownloaded) status[key] = 'downloaded';
          else delete status[key];
          return { status };
        });
      },

      downloadPlaylist: async (playlist, songs) => {
        const key = `p:${playlist.id}`;
        set((s) => ({ status: { ...s.status, [key]: 'downloading' } }));
        try {
          const tag = `playlist:${playlist.id}` as RetainTag;
          for (const song of songs) {
            const trackKey = `t:${song.id}`;
            set((s) => ({ status: { ...s.status, [trackKey]: 'downloading' } }));
            await fetchAndSaveTrack(song, tag);
            set((s) => ({ status: { ...s.status, [trackKey]: 'downloaded' } }));
          }
          await offlineDb.savePlaylist({
            id: playlist.id,
            name: playlist.name,
            comment: playlist.comment,
            coverArtId: playlist.coverArt,
            downloadedAt: Date.now(),
            trackIds: songs.map((s) => s.id),
          });
          set((s) => ({ status: { ...s.status, [key]: 'downloaded' } }));
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Download failed';
          set((s) => {
            const status = { ...s.status };
            delete status[key];
            return { status, errors: { ...s.errors, [key]: message } };
          });
          useToastStore.getState().show(`Couldn't download "${playlist.name}": ${message}`);
        }
      },

      removePlaylistDownload: async (playlistId) => {
        await offlineDb.removePlaylistDownload(playlistId);
        await get().hydrate();
      },

      syncPlaylistDownload: async (playlist, songs) => {
        const meta = await offlineDb.getDownloadedPlaylist(playlist.id);
        if (!meta || syncingPlaylists.has(playlist.id)) return;
        syncingPlaylists.add(playlist.id);
        try {
          const tag = `playlist:${playlist.id}` as RetainTag;
          const members = new Set(meta.trackIds);
          const wanted = new Set(songs.map((s) => s.id));
          let changed = false;

          for (const song of songs) {
            if (members.has(song.id)) continue;
            try {
              // Already on the device (downloaded on its own, say): just keep it for this playlist too.
              if (!(await offlineDb.retainTrack(song.id, tag))) await fetchAndSaveTrack(song, tag);
            } catch {
              continue; // left out; the next sync retries it
            }
            members.add(song.id);
            changed = true;
            set((s) => ({ status: { ...s.status, [`t:${song.id}`]: 'downloaded' } }));
          }

          const removed = [...members].filter((id) => !wanted.has(id));
          for (const id of removed) {
            await offlineDb.releaseTrack(id, tag);
            members.delete(id);
            changed = true;
          }

          const renamed = meta.name !== playlist.name || meta.comment !== playlist.comment;
          if (changed || renamed) {
            await offlineDb.savePlaylist({
              ...meta,
              name: playlist.name,
              comment: playlist.comment,
              trackIds: songs.map((s) => s.id).filter((id) => members.has(id)),
            });
          }
          if (removed.length) await get().hydrate();
        } finally {
          syncingPlaylists.delete(playlist.id);
        }
      },

      saveToDevice: async (song) => {
        const { blob } = await fetchBlob(streamUrl(song.id));
        const url = URL.createObjectURL(blob);
        const ext = song.suffix ?? 'mp3';
        const a = document.createElement('a');
        a.href = url;
        a.download = `${song.artist} - ${song.title}.${ext}`.replace(/[/\\]/g, '-');
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      },
    }),
    {
      name: 'cadence-downloads',
      partialize: (s) => ({ defaultTarget: s.defaultTarget }),
    },
  ),
);
