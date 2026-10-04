import { readdir, stat } from 'fs/promises';
import path from 'path';
import { parseFile } from 'music-metadata';
import type Database from 'better-sqlite3';
import { getDb } from '../db/database.js';

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.ogg',
  '.opus',
  '.aac',
  '.m4a',
  '.mp4',
  '.wav',
  '.aiff',
  '.wv',
  '.ape',
  '.mpc',
]);

export interface ScanResult {
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  renamed: number;
  errors: number;
}

/** A track row not yet matched to a file seen during the current scan. */
interface UnresolvedTrack {
  id: number;
  path: string;
  size: number | null;
  duration_s: number | null;
}

// Deferred track insert/update, applied later in a batch transaction rather
// than as its own implicit autocommit — see flushPending().
type PendingWrite = () => void;

// Flushed at this size (rather than once for the whole scan) so a single
// very large library doesn't hold one write transaction open for the entire
// walk, which would block other writers (scrobbles, stars) for the full
// duration. WAL mode means readers are never blocked either way.
const BATCH_SIZE = 500;

function flushPending(db: Database.Database, pending: PendingWrite[], result: ScanResult): void {
  if (!pending.length) return;
  const batch = pending.splice(0, pending.length);
  const txn = db.transaction((writes: PendingWrite[]) => {
    // One write failing (unexpected — params are already validated by the
    // time they're queued) must not roll back the rest of the batch, same
    // as today's per-file isolation where each write was its own transaction.
    for (const write of writes) {
      try {
        write();
      } catch (err) {
        console.error('[indexer] Error applying deferred write:', err);
        result.errors++;
      }
    }
  });
  txn(batch);
}

/// Atomically claims the next id from the shared artists/albums/tracks
/// counter (see migration 009) — new rows in any of those three tables draw
/// from this instead of their own per-table AUTOINCREMENT, so a new album
/// can never end up with the same numeric id as an unrelated artist.
function nextSharedId(db: Database.Database): number {
  const row = db
    .prepare('UPDATE id_sequence SET next_id = next_id + 1 WHERE id = 1 RETURNING next_id - 1 AS id')
    .get() as { id: number };
  return row.id;
}

// Library paths currently being scanned — guards against two overlapping
// scans of the same library doing redundant/interleaved reads and writes.
// Checked-and-set synchronously (no `await` in between) at the top of
// scanLibrary(), so it's safe even if two scan requests are handled back to
// back on the same event loop tick.
const scansInProgress = new Set<string>();

export function isScanInProgress(libraryPath: string): boolean {
  return scansInProgress.has(libraryPath);
}

// Files seen so far in the current (or most recent) scan of each library —
// reset to 0 when a scan starts, incremented as files are walked, and left
// in place after completion so getScanStatus (Subsonic-native) can report a
// final count without needing a DB column for it.
const scanCounts = new Map<string, number>();

export function getScanCount(libraryPath: string): number {
  return scanCounts.get(libraryPath) ?? 0;
}

export class ScanInProgressError extends Error {
  constructor(libraryPath: string) {
    super(`A scan is already in progress for ${libraryPath}`);
    this.name = 'ScanInProgressError';
  }
}

export async function scanLibrary(libraryPath: string): Promise<ScanResult> {
  if (scansInProgress.has(libraryPath)) throw new ScanInProgressError(libraryPath);
  scansInProgress.add(libraryPath);
  try {
    return await runScan(libraryPath);
  } finally {
    scansInProgress.delete(libraryPath);
  }
}

async function runScan(libraryPath: string): Promise<ScanResult> {
  scanCounts.set(libraryPath, 0);
  const db = getDb();
  const result: ScanResult = { added: 0, updated: 0, skipped: 0, removed: 0, renamed: 0, errors: 0 };

  // Snapshot every track currently indexed under this library root, keyed by
  // path. processFile() deletes an entry as soon as it re-encounters that
  // path, or matches it to a moved/renamed file by content fingerprint —
  // whatever's left once the walk finishes really is gone from disk.
  const rows = db
    .prepare('SELECT id, path, size, duration_s FROM tracks')
    .all() as UnresolvedTrack[];
  const unresolved = new Map(rows.filter((t) => t.path.startsWith(libraryPath)).map((t) => [t.path, t]));

  const pending: PendingWrite[] = [];
  await walkDir(db, libraryPath, result, unresolved, pending, libraryPath);
  flushPending(db, pending, result); // anything left under BATCH_SIZE from the last directory

  // walkDir silently skips a directory it can't read (permission hiccup,
  // flaky network mount, etc.) rather than failing the whole scan — which
  // means "not seen during the walk" isn't proof a file is actually gone.
  // Confirm each candidate directly with its own stat() before deleting it
  // and its history; anything except a definitive ENOENT is left alone.
  for (const track of unresolved.values()) {
    try {
      await stat(track.path);
      continue; // file still exists — walkDir just couldn't reach it this time
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') continue; // inconclusive — don't touch it
    }
    removeTrack(db, track.id);
    result.removed++;
  }

  return result;
}

async function walkDir(
  db: Database.Database,
  dir: string,
  result: ScanResult,
  unresolved: Map<string, UnresolvedTrack>,
  pending: PendingWrite[],
  rootPath: string,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip silently
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(db, fullPath, result, unresolved, pending, rootPath);
    } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      await processFile(db, fullPath, result, unresolved, pending);
      scanCounts.set(rootPath, (scanCounts.get(rootPath) ?? 0) + 1);
      if (pending.length >= BATCH_SIZE) flushPending(db, pending, result);
    }
  }
}

/** Finds an unresolved track whose file this one is likely a moved/renamed
 * copy of — same byte size and (within a second) the same duration. Removed
 * from `unresolved` by the caller once matched, so it can't be reused. */
function findRenameMatch(
  unresolved: Map<string, UnresolvedTrack>,
  size: number,
  duration: number | null,
): UnresolvedTrack | undefined {
  if (duration == null) return undefined;
  for (const track of unresolved.values()) {
    if (track.size === size && track.duration_s != null && Math.abs(track.duration_s - duration) < 1) {
      return track;
    }
  }
  return undefined;
}

async function processFile(
  db: Database.Database,
  filePath: string,
  result: ScanResult,
  unresolved: Map<string, UnresolvedTrack>,
  pending: PendingWrite[],
): Promise<void> {
  try {
    const fileStats = await stat(filePath);
    const mtime = fileStats.mtimeMs;

    const existing = db
      .prepare('SELECT id, mtime, channels FROM tracks WHERE path = ?')
      .get(filePath) as { id: number; mtime: number | null; channels: number | null } | undefined;

    if (existing) {
      unresolved.delete(filePath);
      // `channels` is NULL only for rows scanned before the audio-profile
      // columns existed (migration 015): re-read those once even though the
      // file itself is unchanged, to backfill bit depth / codec / lossless.
      if (existing.mtime === mtime && existing.channels != null) {
        result.skipped++;
        return;
      }
    }

    // skipCovers: true avoids loading large embedded art into memory during a scan
    const meta = await parseFile(filePath, { duration: true, skipCovers: true });
    const { common, format } = meta;

    const artistName = common.artist ?? common.albumartist ?? 'Unknown Artist';
    const albumName = common.album ?? 'Unknown Album';
    const title = common.title ?? path.basename(filePath, path.extname(filePath));

    const artistId = upsertArtist(db, artistName);
    const albumMbid = common.musicbrainz_albumid ?? null;
    const albumId = upsertAlbum(db, albumName, artistId, common.year ?? null, albumMbid);

    const fields = {
      title,
      album_id: albumId,
      artist_id: artistId,
      disc_no: common.disk?.no ?? null,
      track_no: common.track?.no ?? null,
      duration_s: format.duration ?? null,
      size: fileStats.size,
      mtime,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      format: format.container ?? null,
      sample_rate: format.sampleRate ?? null,
      bit_depth: format.bitsPerSample ?? null,
      channels: format.numberOfChannels ?? null,
      codec: format.codec ?? null,
      lossless: format.lossless == null ? null : format.lossless ? 1 : 0,
      replaygain_track: common.replaygain_track_gain?.dB ?? null,
      replaygain_album: common.replaygain_album_gain?.dB ?? null,
      mbid: common.musicbrainz_recordingid ?? null,
      genre: common.genre?.[0] ?? null,
    };

    if (existing) {
      pending.push(() => {
        db.prepare(`
          UPDATE tracks SET
            title = :title, album_id = :album_id, artist_id = :artist_id,
            disc_no = :disc_no, track_no = :track_no, duration_s = :duration_s,
            size = :size, mtime = :mtime, bitrate = :bitrate, format = :format,
            sample_rate = :sample_rate, bit_depth = :bit_depth, channels = :channels,
            codec = :codec, lossless = :lossless, replaygain_track = :replaygain_track,
            replaygain_album = :replaygain_album, mbid = :mbid, genre = :genre
          WHERE path = :path
        `).run({ ...fields, path: filePath });
        result.updated++;
      });
      return;
    }

    // No exact path match — check whether this is really a moved/renamed
    // file rather than a brand-new one. Reusing the old row's id keeps its
    // play history, favorites, and playlist entries attached instead of
    // silently orphaning them under a new track.
    const renameMatch = findRenameMatch(unresolved, fileStats.size, format.duration ?? null);
    if (renameMatch) {
      unresolved.delete(renameMatch.path);
      pending.push(() => {
        db.prepare(`
          UPDATE tracks SET
            title = :title, album_id = :album_id, artist_id = :artist_id,
            disc_no = :disc_no, track_no = :track_no, duration_s = :duration_s,
            path = :path, size = :size, mtime = :mtime, bitrate = :bitrate,
            format = :format, sample_rate = :sample_rate,
            bit_depth = :bit_depth, channels = :channels, codec = :codec, lossless = :lossless,
            replaygain_track = :replaygain_track, replaygain_album = :replaygain_album,
            mbid = :mbid, genre = :genre
          WHERE id = :id
        `).run({ ...fields, path: filePath, id: renameMatch.id });
        result.renamed++;
      });
      return;
    }

    pending.push(() => {
      db.prepare(`
        INSERT INTO tracks
          (id, title, album_id, artist_id, disc_no, track_no, duration_s,
           path, size, mtime, bitrate, format, sample_rate,
           bit_depth, channels, codec, lossless,
           replaygain_track, replaygain_album, mbid, genre)
        VALUES
          (:id, :title, :album_id, :artist_id, :disc_no, :track_no, :duration_s,
           :path, :size, :mtime, :bitrate, :format, :sample_rate,
           :bit_depth, :channels, :codec, :lossless,
           :replaygain_track, :replaygain_album, :mbid, :genre)
      `).run({ ...fields, id: nextSharedId(db), path: filePath });
      result.added++;
    });
  } catch (err) {
    console.error(`[indexer] Error processing ${filePath}:`, err);
    result.errors++;
  }
}

/** Deletes a track whose file is confirmed gone, along with the rows that
 * would otherwise dangle: play_history.track_id has no cascade, and
 * favorites.item_id has no FK at all (it's polymorphic over track/album/
 * artist), so both need explicit cleanup. playlist_tracks cascades via its
 * own FK. Wrapped in a transaction so a mid-sequence failure can't leave the
 * DB half-cleaned. */
function removeTrack(db: Database.Database, trackId: number): void {
  const txn = db.transaction((id: number) => {
    const track = db.prepare('SELECT lyrics_id FROM tracks WHERE id = ?').get(id) as
      { lyrics_id: number | null } | undefined;
    db.prepare("DELETE FROM favorites WHERE item_type = 'track' AND item_id = ?").run(id);
    db.prepare('DELETE FROM play_history WHERE track_id = ?').run(id);
    db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
    if (track?.lyrics_id != null) {
      db.prepare('DELETE FROM lyrics WHERE id = ?').run(track.lyrics_id);
    }
  });
  txn(trackId);
}

export function upsertArtist(db: Database.Database, name: string): number {
  const row = db
    .prepare('SELECT id FROM artists WHERE name = ? COLLATE NOCASE')
    .get(name) as { id: number } | undefined;
  if (row) return row.id;
  const id = nextSharedId(db);
  db.prepare('INSERT INTO artists (id, name) VALUES (?, ?)').run(id, name);
  return id;
}

export function upsertAlbum(
  db: Database.Database,
  name: string,
  artistId: number,
  year: number | null,
  mbid?: string | null,
): number {
  const row = db
    .prepare('SELECT id FROM albums WHERE name = ? COLLATE NOCASE AND artist_id = ?')
    .get(name, artistId) as { id: number } | undefined;
  if (row) {
    // Update mbid if we now have one and didn't before
    if (mbid) db.prepare('UPDATE albums SET mbid = ? WHERE id = ? AND mbid IS NULL').run(mbid, row.id);
    return row.id;
  }
  const id = nextSharedId(db);
  db.prepare('INSERT INTO albums (id, name, artist_id, year, mbid) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, artistId, year, mbid ?? null);
  return id;
}
