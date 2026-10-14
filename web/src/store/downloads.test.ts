import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDownloadsStore } from './downloads';
import { useToastStore } from './toast';
import { setCredentials } from '../api/subsonic';
import * as offlineDb from '../lib/offlineDb';
import type { Song, Playlist } from '../api/types';

function song(id: string, coverArt?: string): Song {
  return {
    id, title: `Track ${id}`, album: 'Album', albumId: 'al-1', artist: 'Artist', artistId: 'ar-1',
    coverArt, created: '2024-01-01', isVideo: false, type: 'music', suffix: 'mp3',
  };
}

function playlist(id: string, name = 'My Playlist'): Playlist {
  return {
    id, name, owner: 'admin', songCount: 0, duration: 0, public: false,
    created: '2024-01-01', changed: '2024-01-01',
  };
}

function mockFetchOk(body = 'audio-bytes', contentType = 'audio/mpeg') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    blob: async () => new Blob([body], { type: contentType }),
  }));
}

beforeEach(async () => {
  setCredentials({ serverUrl: 'http://localhost:4533', username: 'admin', password: 'admin' });
  await offlineDb._resetForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('cadence-offline');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  useDownloadsStore.setState({ status: {}, errors: {}, defaultTarget: 'ask', pendingRequest: null });
  useToastStore.setState({ message: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hydrate', () => {
  it('reflects tracks and playlists already saved offline', async () => {
    await offlineDb.saveTrack(song('1'), new Blob(['x']), 'audio/mpeg', 'individual');
    await offlineDb.savePlaylist({ id: '9', name: 'P', downloadedAt: Date.now(), trackIds: ['1'] });

    await useDownloadsStore.getState().hydrate();

    expect(useDownloadsStore.getState().trackState('1')).toBe('downloaded');
    expect(useDownloadsStore.getState().playlistState('9')).toBe('downloaded');
  });

  it('drops evicted tracks from status (reconciliation)', async () => {
    await offlineDb.saveTrack(song('1'), new Blob(['x']), 'audio/mpeg', 'individual');
    // Simulate eviction: delete the blob but not the metadata, bypassing releaseTrack.
    const idbModule = await import('idb');
    const raw = await idbModule.openDB('cadence-offline', 1);
    await raw.delete('trackBlobs', '1');
    raw.close();
    await offlineDb._resetForTests();

    await useDownloadsStore.getState().hydrate();
    expect(useDownloadsStore.getState().trackState('1')).toBeUndefined();
  });
});

describe('downloadTrack', () => {
  it('transitions downloading -> downloaded and persists the track', async () => {
    mockFetchOk();
    const s = song('1', 'al-1');
    const promise = useDownloadsStore.getState().downloadTrack(s);
    expect(useDownloadsStore.getState().trackState('1')).toBe('downloading');
    await promise;
    expect(useDownloadsStore.getState().trackState('1')).toBe('downloaded');

    const saved = await offlineDb.getAllDownloadedTracks();
    expect(saved).toHaveLength(1);
    expect(saved[0].retainedBy).toEqual(['individual']);
  });

  it('reverts to not-downloaded and records an error on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await useDownloadsStore.getState().downloadTrack(song('1'));

    expect(useDownloadsStore.getState().trackState('1')).toBeUndefined();
    expect(useDownloadsStore.getState().errors['t:1']).toMatch(/failed/i);
    expect(await offlineDb.isTrackDownloaded('1')).toBe(false);
  });

  // #12: the `errors` record was already populated on failure, but nothing
  // in the UI ever read it — a failed download reverted silently. Surfaced
  // via a toast now.
  it('surfaces a fetch failure via the toast store', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await useDownloadsStore.getState().downloadTrack(song('1'));

    expect(useToastStore.getState().message).toMatch(/track 1/i);
    expect(useToastStore.getState().message).toMatch(/failed/i);
  });

  it('cover art fetch failure does not fail the track download', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'audio/mpeg' },
          blob: async () => new Blob(['audio']),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));

    await useDownloadsStore.getState().downloadTrack(song('1', 'al-1'));
    expect(useDownloadsStore.getState().trackState('1')).toBe('downloaded');
  });
});

describe('removeTrackDownload', () => {
  it('clears status once the only retain tag is released', async () => {
    mockFetchOk();
    await useDownloadsStore.getState().downloadTrack(song('1'));
    expect(useDownloadsStore.getState().trackState('1')).toBe('downloaded');

    await useDownloadsStore.getState().removeTrackDownload('1');
    expect(useDownloadsStore.getState().trackState('1')).toBeUndefined();
    expect(await offlineDb.isTrackDownloaded('1')).toBe(false);
  });

  it('keeps status downloaded if the track is still retained by a downloaded playlist', async () => {
    mockFetchOk();
    const pl = playlist('9');
    await useDownloadsStore.getState().downloadPlaylist(pl, [song('1')]);
    await useDownloadsStore.getState().downloadTrack(song('1')); // also individually downloaded

    await useDownloadsStore.getState().removeTrackDownload('1');
    expect(useDownloadsStore.getState().trackState('1')).toBe('downloaded');
  });
});

describe('downloadPlaylist / removePlaylistDownload', () => {
  it('downloads every track and marks the playlist downloaded', async () => {
    mockFetchOk();
    const pl = playlist('9');
    const songs = [song('1'), song('2')];

    await useDownloadsStore.getState().downloadPlaylist(pl, songs);

    expect(useDownloadsStore.getState().playlistState('9')).toBe('downloaded');
    expect(useDownloadsStore.getState().trackState('1')).toBe('downloaded');
    expect(useDownloadsStore.getState().trackState('2')).toBe('downloaded');
    expect(await offlineDb.getAllDownloadedTracks()).toHaveLength(2);
  });

  it('removing a downloaded playlist releases its tracks and clears its own status', async () => {
    mockFetchOk();
    const pl = playlist('9');
    await useDownloadsStore.getState().downloadPlaylist(pl, [song('1'), song('2')]);

    await useDownloadsStore.getState().removePlaylistDownload('9');

    expect(useDownloadsStore.getState().playlistState('9')).toBeUndefined();
    expect(useDownloadsStore.getState().trackState('1')).toBeUndefined();
    expect(useDownloadsStore.getState().trackState('2')).toBeUndefined();
    expect(await offlineDb.getAllDownloadedTracks()).toHaveLength(0);
  });

  it('removing a downloaded playlist does not affect a track also downloaded individually', async () => {
    mockFetchOk();
    await useDownloadsStore.getState().downloadTrack(song('1'));
    await useDownloadsStore.getState().downloadPlaylist(playlist('9'), [song('1')]);

    await useDownloadsStore.getState().removePlaylistDownload('9');

    expect(useDownloadsStore.getState().trackState('1')).toBe('downloaded');
    expect(await offlineDb.isTrackDownloaded('1')).toBe(true);
  });
});

describe('syncPlaylistDownload', () => {
  it('does nothing for a playlist that was never downloaded', async () => {
    mockFetchOk();

    await useDownloadsStore.getState().syncPlaylistDownload(playlist('9'), [song('1')]);

    expect(fetch).not.toHaveBeenCalled();
    expect(await offlineDb.getAllDownloadedTracks()).toHaveLength(0);
  });

  it('downloads a track added to the playlist since and groups it', async () => {
    mockFetchOk();
    await useDownloadsStore.getState().downloadPlaylist(playlist('9'), [song('1')]);

    await useDownloadsStore.getState().syncPlaylistDownload(playlist('9'), [song('1'), song('2')]);

    expect(useDownloadsStore.getState().trackState('2')).toBe('downloaded');
    expect((await offlineDb.getDownloadedPlaylist('9'))?.trackIds).toEqual(['1', '2']);
    const two = (await offlineDb.getAllDownloadedTracks()).find((t) => t.id === '2');
    expect(two?.retainedBy).toEqual(['playlist:9']);
  });

  it('keeps a track that is already on the device instead of fetching it again', async () => {
    mockFetchOk();
    await useDownloadsStore.getState().downloadPlaylist(playlist('9'), [song('1')]);
    await useDownloadsStore.getState().downloadTrack(song('2'));
    vi.mocked(fetch).mockClear();

    await useDownloadsStore.getState().syncPlaylistDownload(playlist('9'), [song('1'), song('2')]);

    expect(fetch).not.toHaveBeenCalled();
    const two = (await offlineDb.getAllDownloadedTracks()).find((t) => t.id === '2');
    expect(two?.retainedBy.sort()).toEqual(['individual', 'playlist:9']);
  });

  it('a failed download is left out and retried by the next sync', async () => {
    mockFetchOk();
    await useDownloadsStore.getState().downloadPlaylist(playlist('9'), [song('1')]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await useDownloadsStore.getState().syncPlaylistDownload(playlist('9'), [song('1'), song('2')]);
    expect((await offlineDb.getDownloadedPlaylist('9'))?.trackIds).toEqual(['1']);

    mockFetchOk();
    await useDownloadsStore.getState().syncPlaylistDownload(playlist('9'), [song('1'), song('2')]);
    expect((await offlineDb.getDownloadedPlaylist('9'))?.trackIds).toEqual(['1', '2']);
  });

  it('releases a track removed from the playlist, but not one also downloaded individually', async () => {
    mockFetchOk();
    await useDownloadsStore.getState().downloadTrack(song('2'));
    await useDownloadsStore.getState().downloadPlaylist(playlist('9'), [song('1'), song('2')]);

    await useDownloadsStore.getState().syncPlaylistDownload(playlist('9'), []);

    expect(await offlineDb.isTrackDownloaded('1')).toBe(false);
    expect(useDownloadsStore.getState().trackState('1')).toBeUndefined();
    expect(await offlineDb.isTrackDownloaded('2')).toBe(true);
    expect((await offlineDb.getDownloadedPlaylist('9'))?.trackIds).toEqual([]);
  });

  it('keeps the stored name in step with the playlist', async () => {
    mockFetchOk();
    await useDownloadsStore.getState().downloadPlaylist(playlist('9', 'Old'), [song('1')]);

    await useDownloadsStore.getState().syncPlaylistDownload(playlist('9', 'Renamed'), [song('1')]);

    expect((await offlineDb.getDownloadedPlaylist('9'))?.name).toBe('Renamed');
  });
});

describe('saveToDevice', () => {
  it('fetches the audio and triggers a browser download without touching offline storage', async () => {
    mockFetchOk();
    const clicked = vi.fn();
    const anchor = { click: clicked, remove: vi.fn(), href: '', download: '' };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() });

    await useDownloadsStore.getState().saveToDevice(song('1'));

    expect(clicked).toHaveBeenCalledTimes(1);
    expect(anchor.download).toContain('Track 1');
    expect(await offlineDb.isTrackDownloaded('1')).toBe(false);
  });
});

describe('requestDownload / resolvePendingRequest / cancelPendingRequest', () => {
  it('asks (sets pendingRequest) when no default target is set yet', () => {
    useDownloadsStore.getState().requestDownload({ kind: 'track', song: song('1') });
    expect(useDownloadsStore.getState().pendingRequest).toEqual({ kind: 'track', song: song('1') });
    // Nothing should have started downloading yet — it's waiting on the user's choice.
    expect(useDownloadsStore.getState().trackState('1')).toBeUndefined();
  });

  it('proceeds immediately (no prompt) once a default target is set', async () => {
    mockFetchOk();
    useDownloadsStore.setState({ defaultTarget: 'app' });

    useDownloadsStore.getState().requestDownload({ kind: 'track', song: song('1') });
    expect(useDownloadsStore.getState().pendingRequest).toBeNull();

    await vi.waitFor(() => expect(useDownloadsStore.getState().trackState('1')).toBe('downloaded'));
  });

  it('resolvePendingRequest(app, remember=true) downloads into the app and persists the default', async () => {
    mockFetchOk();
    useDownloadsStore.getState().requestDownload({ kind: 'track', song: song('1') });

    await useDownloadsStore.getState().resolvePendingRequest('app', true);

    expect(useDownloadsStore.getState().pendingRequest).toBeNull();
    expect(useDownloadsStore.getState().defaultTarget).toBe('app');
    expect(useDownloadsStore.getState().trackState('1')).toBe('downloaded');
  });

  it('resolvePendingRequest(device, remember=false) saves to device and does not persist a default', async () => {
    mockFetchOk();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ click: vi.fn(), remove: vi.fn(), href: '', download: '' })),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() });

    useDownloadsStore.getState().requestDownload({ kind: 'track', song: song('1') });
    await useDownloadsStore.getState().resolvePendingRequest('device', false);

    expect(useDownloadsStore.getState().defaultTarget).toBe('ask');
    expect(await offlineDb.isTrackDownloaded('1')).toBe(false); // saved to device, not offline storage
  });

  it('surfaces a save-to-device failure via the toast store instead of an unhandled rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    useDownloadsStore.getState().requestDownload({ kind: 'track', song: song('1') });
    await expect(useDownloadsStore.getState().resolvePendingRequest('device', false)).resolves.toBeUndefined();

    expect(useToastStore.getState().message).toMatch(/failed/i);
  });

  it('resolvePendingRequest for a playlist request downloads all its tracks', async () => {
    mockFetchOk();
    const pl = playlist('9');
    useDownloadsStore.getState().requestDownload({ kind: 'playlist', playlist: pl, songs: [song('1'), song('2')] });

    await useDownloadsStore.getState().resolvePendingRequest('app', false);

    expect(useDownloadsStore.getState().playlistState('9')).toBe('downloaded');
    expect(await offlineDb.getAllDownloadedTracks()).toHaveLength(2);
  });

  it('cancelPendingRequest clears the prompt without downloading anything', async () => {
    useDownloadsStore.getState().requestDownload({ kind: 'track', song: song('1') });
    useDownloadsStore.getState().cancelPendingRequest();

    expect(useDownloadsStore.getState().pendingRequest).toBeNull();
    expect(await offlineDb.isTrackDownloaded('1')).toBe(false);
  });
});
