import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Song } from '../api/types';

const DB_NAME = 'cadence-offline';
const DB_VERSION = 1;

/** Tag identifying why a track is retained offline — deleted once no tag remains. */
export type RetainTag = 'individual' | `playlist:${string}`;

export interface DownloadedTrackMeta {
  id: string;
  song: Song;
  coverArtId?: string;
  sizeBytes: number;
  downloadedAt: number;
  retainedBy: RetainTag[];
}

export interface DownloadedPlaylistMeta {
  id: string;
  name: string;
  comment?: string;
  coverArtId?: string;
  downloadedAt: number;
  trackIds: string[];
}

interface BlobRecord {
  id: string;
  blob: Blob;
  mimeType: string;
}

interface OfflineDBSchema extends DBSchema {
  trackMeta: { key: string; value: DownloadedTrackMeta };
  trackBlobs: { key: string; value: BlobRecord };
  coverBlobs: { key: string; value: BlobRecord };
  playlists: { key: string; value: DownloadedPlaylistMeta };
}

let dbPromise: Promise<IDBPDatabase<OfflineDBSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<OfflineDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('trackMeta')) db.createObjectStore('trackMeta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('trackBlobs')) db.createObjectStore('trackBlobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('coverBlobs')) db.createObjectStore('coverBlobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

/** Test-only: close the current connection and force a fresh one on the next call. */
export async function _resetForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getAllDownloadedTracks(): Promise<DownloadedTrackMeta[]> {
  const db = await getDb();
  return db.getAll('trackMeta');
}

export async function getDownloadedTrackIds(): Promise<string[]> {
  const db = await getDb();
  return db.getAllKeys('trackMeta');
}

export async function getAllDownloadedPlaylists(): Promise<DownloadedPlaylistMeta[]> {
  const db = await getDb();
  return db.getAll('playlists');
}

export async function getDownloadedPlaylist(id: string): Promise<DownloadedPlaylistMeta | undefined> {
  const db = await getDb();
  return db.get('playlists', id);
}

/** Fetch multiple tracks' metadata, preserving the order of `ids` and skipping any not downloaded. */
export async function getTracksByIds(ids: string[]): Promise<DownloadedTrackMeta[]> {
  const db = await getDb();
  const results = await Promise.all(ids.map((id) => db.get('trackMeta', id)));
  return results.filter((r): r is DownloadedTrackMeta => !!r);
}

export async function getTrackAudioBlob(id: string): Promise<{ blob: Blob; mimeType: string } | null> {
  const db = await getDb();
  const row = await db.get('trackBlobs', id);
  return row ? { blob: row.blob, mimeType: row.mimeType } : null;
}

export async function getCoverBlob(id: string): Promise<Blob | null> {
  const db = await getDb();
  const row = await db.get('coverBlobs', id);
  return row?.blob ?? null;
}

export async function isTrackDownloaded(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.getKey('trackMeta', id)) !== undefined;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function saveCoverBlob(id: string, blob: Blob, mimeType: string): Promise<void> {
  const db = await getDb();
  await db.put('coverBlobs', { id, blob, mimeType });
}

/** Save/update a track's offline copy, adding `retainTag` to the set of reasons it's kept. */
export async function saveTrack(
  song: Song,
  audioBlob: Blob,
  mimeType: string,
  retainTag: RetainTag,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['trackMeta', 'trackBlobs'], 'readwrite');
  const metaStore = tx.objectStore('trackMeta');
  const existing = await metaStore.get(song.id);
  const retainedBy = new Set(existing?.retainedBy ?? []);
  retainedBy.add(retainTag);

  const meta: DownloadedTrackMeta = {
    id: song.id,
    song,
    coverArtId: song.coverArt,
    sizeBytes: audioBlob.size,
    downloadedAt: existing?.downloadedAt ?? Date.now(),
    retainedBy: [...retainedBy],
  };
  await metaStore.put(meta);
  await tx.objectStore('trackBlobs').put({ id: song.id, blob: audioBlob, mimeType });
  await tx.done;
}

/** Adds `retainTag` to a track that is already on the device. False if it isn't. */
export async function retainTrack(trackId: string, retainTag: RetainTag): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction('trackMeta', 'readwrite');
  const existing = await tx.store.get(trackId);
  if (existing && !existing.retainedBy.includes(retainTag)) {
    await tx.store.put({ ...existing, retainedBy: [...existing.retainedBy, retainTag] });
  }
  await tx.done;
  return !!existing;
}

/**
 * Remove one retain reason from a track. Once no reason remains, the track's
 * metadata and audio blob are deleted entirely — this is what makes removing
 * a download (individual or via a playlist) actually free the track, while
 * leaving it intact if something else still needs it.
 */
export async function releaseTrack(trackId: string, tag: RetainTag): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['trackMeta', 'trackBlobs'], 'readwrite');
  const metaStore = tx.objectStore('trackMeta');
  const existing = await metaStore.get(trackId);
  if (!existing) {
    await tx.done;
    return;
  }

  const retainedBy = existing.retainedBy.filter((t) => t !== tag);
  if (retainedBy.length === 0) {
    await metaStore.delete(trackId);
    await tx.objectStore('trackBlobs').delete(trackId);
  } else {
    await metaStore.put({ ...existing, retainedBy });
  }
  await tx.done;
}

export async function savePlaylist(meta: DownloadedPlaylistMeta): Promise<void> {
  const db = await getDb();
  await db.put('playlists', meta);
}

/** Remove a downloaded playlist record and release its tag from every one of its tracks. */
export async function removePlaylistDownload(playlistId: string): Promise<void> {
  const db = await getDb();
  const meta = await db.get('playlists', playlistId);
  if (!meta) return;
  await db.delete('playlists', playlistId);
  const tag: RetainTag = `playlist:${playlistId}`;
  await Promise.all(meta.trackIds.map((id) => releaseTrack(id, tag)));
}

/**
 * Drop any track whose audio blob is missing (e.g. evicted by the browser,
 * notably iOS Safari's storage eviction) so the UI never claims a track is
 * playable offline when it silently no longer is. Returns the ids dropped.
 */
export async function reconcileEvictedTracks(): Promise<string[]> {
  const db = await getDb();
  const allMeta = await db.getAll('trackMeta');
  const dropped: string[] = [];
  for (const meta of allMeta) {
    const hasBlob = (await db.getKey('trackBlobs', meta.id)) !== undefined;
    if (!hasBlob) {
      await db.delete('trackMeta', meta.id);
      dropped.push(meta.id);
    }
  }
  return dropped;
}
