import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, unlink, rename, utimes, chmod } from 'fs/promises';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { initDb, closeDb } from '../../db/database.js';
import { runMigrations } from '../../db/migrate.js';
import { scanLibrary, upsertArtist, upsertAlbum, isScanInProgress, ScanInProgressError } from '../../indexer/scan.js';
import type Database from 'better-sqlite3';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid WAV file. Includes a fixed chunk of silent PCM data (rather
 * than a zero-length data chunk) so music-metadata reports a real, non-zero
 * duration — needed for tests that rely on scanLibrary's size+duration
 * rename-fingerprint matching. */
function writeWav(filePath: string, dataBytes = 4410): void {
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 1 channel
  buf.writeUInt32LE(44100, 24); // sample rate
  buf.writeUInt32LE(88200, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  writeFileSync(filePath, buf);
}

const MIGRATIONS_DIR = new URL('../../../migrations', import.meta.url).pathname;

// ── fixtures ─────────────────────────────────────────────────────────────────

let db: Database.Database;
let tmpDir: string;

beforeEach(async () => {
  db = initDb(':memory:');
  await runMigrations(db, MIGRATIONS_DIR);
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'riffplayer-test-'));
});

afterEach(async () => {
  closeDb();
  await rm(tmpDir, { recursive: true });
});

// ── upsert helpers ────────────────────────────────────────────────────────────

describe('upsertArtist', () => {
  it('creates an artist and returns its id', () => {
    const id = upsertArtist(db, 'Radiohead');
    expect(id).toBeGreaterThan(0);
  });

  it('returns the same id on repeated calls (case-insensitive)', () => {
    const a = upsertArtist(db, 'Radiohead');
    const b = upsertArtist(db, 'RADIOHEAD');
    expect(a).toBe(b);
  });
});

describe('upsertAlbum', () => {
  it('creates an album under the right artist', () => {
    const artistId = upsertArtist(db, 'Radiohead');
    const id = upsertAlbum(db, 'OK Computer', artistId, 1997);
    expect(id).toBeGreaterThan(0);

    const row = db.prepare('SELECT year FROM albums WHERE id = ?').get(id) as { year: number };
    expect(row.year).toBe(1997);
  });

  it('returns the same id for the same album/artist pair', () => {
    const artistId = upsertArtist(db, 'Radiohead');
    const a = upsertAlbum(db, 'OK Computer', artistId, 1997);
    const b = upsertAlbum(db, 'OK Computer', artistId, 1997);
    expect(a).toBe(b);
  });

  it('creates separate albums for different artists with the same name', () => {
    const r = upsertArtist(db, 'Radiohead');
    const b = upsertArtist(db, 'Blur');
    const idR = upsertAlbum(db, 'Self-Titled', r, null);
    const idB = upsertAlbum(db, 'Self-Titled', b, null);
    expect(idR).not.toBe(idB);
  });
});

// ── full scan ─────────────────────────────────────────────────────────────────

describe('scanLibrary', () => {
  it('adds audio files to the DB', async () => {
    writeWav(path.join(tmpDir, 'track.wav'));

    const result = await scanLibrary(tmpDir);

    expect(result.added).toBe(1);
    expect(result.errors).toBe(0);

    const count = (db.prepare('SELECT COUNT(*) as n FROM tracks').get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it('ignores non-audio files', async () => {
    writeFileSync(path.join(tmpDir, 'cover.jpg'), 'not audio');
    writeFileSync(path.join(tmpDir, 'info.txt'), 'not audio');

    const result = await scanLibrary(tmpDir);
    expect(result.added).toBe(0);
  });

  it('recurses into subdirectories', async () => {
    const sub = path.join(tmpDir, 'Artist', 'Album');
    mkdirSync(sub, { recursive: true });
    writeWav(path.join(sub, 'track1.wav'));
    writeWav(path.join(sub, 'track2.wav'));

    const result = await scanLibrary(tmpDir);
    expect(result.added).toBe(2);
  });

  it('skips unchanged files on re-scan (same mtime)', async () => {
    const p = path.join(tmpDir, 'track.wav');
    writeWav(p);

    await scanLibrary(tmpDir);
    const result2 = await scanLibrary(tmpDir);

    expect(result2.added).toBe(0);
    expect(result2.skipped).toBe(1);
  });

  it('re-indexes a file whose mtime changed', async () => {
    const p = path.join(tmpDir, 'track.wav');
    writeWav(p);
    await scanLibrary(tmpDir);

    // Advance mtime by 1 second
    const future = new Date(Date.now() + 1000);
    await utimes(p, future, future);

    const result2 = await scanLibrary(tmpDir);
    expect(result2.updated).toBe(1);
    expect(result2.added).toBe(0);
  });

  it('does not create duplicate artists or albums across scans', async () => {
    writeWav(path.join(tmpDir, 'track.wav'));
    await scanLibrary(tmpDir);
    await scanLibrary(tmpDir);

    const artists = (db.prepare('SELECT COUNT(*) as n FROM artists').get() as { n: number }).n;
    const albums = (db.prepare('SELECT COUNT(*) as n FROM albums').get() as { n: number }).n;
    expect(artists).toBe(1);
    expect(albums).toBe(1);
  });

  it('handles an empty directory without error', async () => {
    const result = await scanLibrary(tmpDir);
    expect(result).toEqual({ added: 0, updated: 0, skipped: 0, removed: 0, renamed: 0, errors: 0 });
  });

  it('increments errors counter for permission-denied audio files', async () => {
    const filePath = path.join(tmpDir, 'locked.wav');
    writeWav(filePath);
    // Remove read permission so parseFile fails with EACCES
    await chmod(filePath, 0o000);

    const result = await scanLibrary(tmpDir);

    // Restore permission so afterEach cleanup can delete the file
    await chmod(filePath, 0o644);

    expect(result.errors).toBe(1);
    expect(result.added).toBe(0);
  });

  it('removes a track whose file was deleted from disk', async () => {
    const p = path.join(tmpDir, 'track.wav');
    writeWav(p);
    await scanLibrary(tmpDir);

    await unlink(p);
    const result = await scanLibrary(tmpDir);

    expect(result.removed).toBe(1);
    const count = (db.prepare('SELECT COUNT(*) as n FROM tracks').get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it('does not delete a track whose directory merely failed to read this scan', async () => {
    const sub = path.join(tmpDir, 'locked');
    mkdirSync(sub, { recursive: true });
    const p = path.join(sub, 'track.wav');
    writeWav(p);
    await scanLibrary(tmpDir);
    const before = (db.prepare('SELECT COUNT(*) as n FROM tracks').get() as { n: number }).n;
    expect(before).toBe(1);

    // Deny read on the directory itself so walkDir's readdir() fails and
    // silently skips it — the file underneath still exists on disk though.
    await chmod(sub, 0o000);
    let result: Awaited<ReturnType<typeof scanLibrary>>;
    try {
      result = await scanLibrary(tmpDir);
    } finally {
      await chmod(sub, 0o755);
    }

    expect(result.removed).toBe(0);
    const after = (db.prepare('SELECT COUNT(*) as n FROM tracks').get() as { n: number }).n;
    expect(after).toBe(1);
  });

  it('cleans up play_history and favorites for a removed track without throwing', async () => {
    const p = path.join(tmpDir, 'track.wav');
    writeWav(p);
    await scanLibrary(tmpDir);
    const trackId = (db.prepare('SELECT id FROM tracks').get() as { id: number }).id;

    const userId = Number(
      db.prepare("INSERT INTO users (username, password_hash) VALUES ('u', 'x')").run().lastInsertRowid,
    );
    db.prepare('INSERT INTO play_history (user_id, track_id) VALUES (?, ?)').run(userId, trackId);
    db.prepare("INSERT INTO favorites (user_id, item_type, item_id) VALUES (?, 'track', ?)").run(userId, trackId);

    await unlink(p);
    const result = await scanLibrary(tmpDir);

    expect(result.removed).toBe(1);
    expect((db.prepare('SELECT COUNT(*) as n FROM play_history').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) as n FROM favorites').get() as { n: number }).n).toBe(0);
  });

  it('detects a moved/renamed file by fingerprint and keeps its id and history', async () => {
    const oldPath = path.join(tmpDir, 'old-name.wav');
    writeWav(oldPath);
    await scanLibrary(tmpDir);
    const trackId = (db.prepare('SELECT id FROM tracks').get() as { id: number }).id;

    const userId = Number(
      db.prepare("INSERT INTO users (username, password_hash) VALUES ('u', 'x')").run().lastInsertRowid,
    );
    db.prepare('INSERT INTO play_history (user_id, track_id) VALUES (?, ?)').run(userId, trackId);

    const newDir = path.join(tmpDir, 'Renamed Folder');
    mkdirSync(newDir, { recursive: true });
    const newPath = path.join(newDir, 'new-name.wav');
    await rename(oldPath, newPath);

    const result = await scanLibrary(tmpDir);

    expect(result.renamed).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.added).toBe(0);

    const track = db.prepare('SELECT id, path FROM tracks').get() as { id: number; path: string };
    expect(track.id).toBe(trackId);
    expect(track.path).toBe(newPath);

    const historyCount = (
      db.prepare('SELECT COUNT(*) as n FROM play_history WHERE track_id = ?').get(trackId) as { n: number }
    ).n;
    expect(historyCount).toBe(1);
  });

  it('rejects a second concurrent scan of the same library', async () => {
    writeWav(path.join(tmpDir, 'track.wav'));

    const first = scanLibrary(tmpDir);
    await expect(scanLibrary(tmpDir)).rejects.toThrow(ScanInProgressError);
    await expect(first).resolves.toMatchObject({ added: 1 });
  });

  it('isScanInProgress reflects the in-flight state and clears once done', async () => {
    writeWav(path.join(tmpDir, 'track.wav'));

    expect(isScanInProgress(tmpDir)).toBe(false);
    const pending = scanLibrary(tmpDir);
    expect(isScanInProgress(tmpDir)).toBe(true);
    await pending;
    expect(isScanInProgress(tmpDir)).toBe(false);
  });

  it('allows scanning the same library again once the previous scan finishes', async () => {
    writeWav(path.join(tmpDir, 'track.wav'));

    await scanLibrary(tmpDir);
    await expect(scanLibrary(tmpDir)).resolves.toMatchObject({ skipped: 1 });
  });

  it('batches multiple new-file inserts into a single transaction rather than one per file (#16)', async () => {
    writeWav(path.join(tmpDir, 'a.wav'));
    writeWav(path.join(tmpDir, 'b.wav'));
    writeWav(path.join(tmpDir, 'c.wav'));

    const txnSpy = vi.spyOn(db, 'transaction');
    const result = await scanLibrary(tmpDir);

    expect(result.added).toBe(3);
    // Under BATCH_SIZE, so the whole scan's writes land in exactly one
    // db.transaction() call — not three separate implicit-autocommit writes.
    expect(txnSpy).toHaveBeenCalledTimes(1);
  });

  it('still commits everything found so far, even for a library smaller than one batch', async () => {
    writeWav(path.join(tmpDir, 'a.wav'));
    await scanLibrary(tmpDir);

    const count = (db.prepare('SELECT COUNT(*) as n FROM tracks').get() as { n: number }).n;
    expect(count).toBe(1);
  });
});

// ── audio profile (Hi-Fi quality info) ───────────────────────────────────────

describe('scanLibrary — audio profile', () => {
  const profile = () =>
    db.prepare('SELECT sample_rate, bit_depth, channels, codec, lossless FROM tracks').get() as {
      sample_rate: number | null; bit_depth: number | null; channels: number | null;
      codec: string | null; lossless: number | null;
    };

  it('stores sample rate, bit depth, channels and losslessness', async () => {
    writeWav(path.join(tmpDir, 'track.wav'));
    await scanLibrary(tmpDir);

    const p = profile();
    expect(p.sample_rate).toBe(44100);
    expect(p.bit_depth).toBe(16);
    expect(p.channels).toBe(1);
    expect(p.lossless).toBe(1);
    expect(p.codec).toBeTruthy();
  });

  it('re-reads an unchanged file once when its profile was never recorded (pre-migration rows)', async () => {
    writeWav(path.join(tmpDir, 'track.wav'));
    await scanLibrary(tmpDir);
    db.prepare('UPDATE tracks SET bit_depth = NULL, channels = NULL, codec = NULL, lossless = NULL').run();

    const backfill = await scanLibrary(tmpDir);
    expect(backfill.updated).toBe(1);
    expect(backfill.skipped).toBe(0);
    expect(profile().bit_depth).toBe(16);

    const again = await scanLibrary(tmpDir);
    expect(again.skipped).toBe(1); // ...but only once
    expect(again.updated).toBe(0);
  });
});
