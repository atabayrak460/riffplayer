import { getDb } from '../db/database.js';
import { matchKey } from './normalise.js';
import type { ImportedPlay, ImportSource } from './types.js';

/** Last.fm has no play length; this is only used for "minutes listened" on songs not in the library. */
const ASSUMED_LENGTH_MS = 210_000;
/** A RiffPlayer play and its scrobble to Last.fm differ by seconds; treat these as one listen. */
const SAME_PLAY_WINDOW_S = 180;

export interface ImportResult {
  found: number;
  added: number;
  duplicates: number;
  matched: number;
}

export interface ImportSummary {
  source: ImportSource;
  plays: number;
  matched: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
}

function libraryIndex(): Map<string, { id: number; durationMs: number }> {
  const rows = getDb()
    .prepare(`
      SELECT t.id, t.title, t.duration_s, ar.name AS artist
      FROM tracks t JOIN artists ar ON ar.id = t.artist_id
    `)
    .all() as { id: number; title: string; duration_s: number | null; artist: string }[];
  const index = new Map<string, { id: number; durationMs: number }>();
  for (const r of rows) {
    const key = matchKey(r.artist, r.title);
    if (!index.has(key)) index.set(key, { id: r.id, durationMs: (r.duration_s ?? 0) * 1000 });
  }
  return index;
}

/**
 * Saves imported plays for one user. Safe to run again with the same export: identical plays are
 * skipped, and a Last.fm scrobble of something already played in RiffPlayer is not counted twice.
 */
export function importPlays(userId: number, source: ImportSource, plays: ImportedPlay[]): ImportResult {
  const db = getDb();
  const index = libraryIndex();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO external_plays
      (user_id, source, artist, title, album, played_at, duration_ms, track_id, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ownPlay = db.prepare(
    'SELECT 1 FROM play_history WHERE user_id = ? AND track_id = ? AND played_at BETWEEN ? AND ? LIMIT 1',
  );

  const result: ImportResult = { found: plays.length, added: 0, duplicates: 0, matched: 0 };
  db.transaction(() => {
    for (const p of plays) {
      const key = matchKey(p.artist, p.title);
      const lib = index.get(key);

      if (lib && ownPlay.get(userId, lib.id, p.playedAt - SAME_PLAY_WINDOW_S, p.playedAt + SAME_PLAY_WINDOW_S)) {
        result.duplicates++;
        continue;
      }
      const duration = p.durationMs || lib?.durationMs || ASSUMED_LENGTH_MS;
      const info = insert.run(
        userId, source, p.artist, p.title, p.album, p.playedAt, duration, lib?.id ?? null,
        `${source}|${p.playedAt}|${key}`,
      );
      if (info.changes === 0) result.duplicates++;
      else {
        result.added++;
        if (lib) result.matched++;
      }
    }
  })();
  return result;
}

export function importSummary(userId: number): ImportSummary[] {
  return (getDb()
    .prepare(`
      SELECT source, COUNT(*) AS plays, COUNT(track_id) AS matched,
             MIN(played_at) AS firstPlayedAt, MAX(played_at) AS lastPlayedAt
      FROM external_plays WHERE user_id = ? GROUP BY source ORDER BY source
    `)
    .all(userId) as ImportSummary[]);
}

export function deleteImported(userId: number, source?: ImportSource): number {
  const db = getDb();
  return source
    ? db.prepare('DELETE FROM external_plays WHERE user_id = ? AND source = ?').run(userId, source).changes
    : db.prepare('DELETE FROM external_plays WHERE user_id = ?').run(userId).changes;
}
