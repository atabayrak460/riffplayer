import { getDb } from '../db/database.js';
import { SONG_SELECT_LIST, SONG_FROM } from '../routes/subsonic/endpoints/browse.js';
import type { SongRow } from '../routes/subsonic/serialize.js';

// "Song radio": an endless, varied queue seeded by a song, artist, album or playlist — built from
// the user's own library with no AI. The signals, strongest first:
//   • co-listening: tracks that were played close in time to the seeds (any user, 30-minute window)
//   • same artist, same genre, similar era
//   • optional bonus for artists Last.fm calls similar (names matched against the library, supplied by the caller)
//   • the user's own taste (favourites, play counts) and a penalty for what they just heard
// then picked greedily with diversity rules so the same artist never dominates.

export type RadioSeedType = 'song' | 'artist' | 'album' | 'playlist';

export interface RadioOptions {
  userId: number;
  type: RadioSeedType;
  id: number;
  count: number;
  /** Track ids already queued — never returned again. */
  exclude?: number[];
  /** Library artist ids a similarity service rates close to the seed (a bonus, never required). */
  similarArtistIds?: number[];
  /** Injectable for tests. */
  random?: () => number;
  now?: number;
}

const CO_LISTEN_WINDOW_S = 30 * 60;
const MAX_CANDIDATES = 800;
const RECENT_PENALTY_S = 12 * 3600;

interface Candidate {
  id: number;
  artistId: number;
  albumId: number;
  genre: string | null;
  year: number | null;
  starred: boolean;
  plays: number;
  lastPlayed: number | null;
}

const placeholders = (n: number) => Array(n).fill('?').join(',');

/** The tracks a seed stands for. */
function seedTrackIds(type: RadioSeedType, id: number, userId: number): number[] {
  const db = getDb();
  const col = (sql: string, ...args: unknown[]) => (db.prepare(sql).all(...args) as { id: number }[]).map((r) => r.id);
  switch (type) {
    case 'song':
      return col('SELECT id FROM tracks WHERE id = ?', id);
    case 'album':
      return col('SELECT id FROM tracks WHERE album_id = ?', id);
    case 'playlist':
      return col(
        `SELECT pt.track_id AS id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
         WHERE pt.playlist_id = ? AND (p.owner_id = ? OR p.is_public = 1)`,
        id, userId,
      );
    case 'artist': {
      // The artist's tracks this user plays most, then the rest — a stand-in for "what this artist sounds like".
      return col(
        `SELECT t.id FROM tracks t LEFT JOIN play_history ph ON ph.track_id = t.id AND ph.user_id = ?
         WHERE t.artist_id = ? GROUP BY t.id ORDER BY COUNT(ph.id) DESC, t.id LIMIT 25`,
        userId, id,
      );
    }
  }
}

export function buildRadio(opts: RadioOptions): SongRow[] {
  const db = getDb();
  const rand = opts.random ?? Math.random;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const count = Math.min(Math.max(opts.count, 1), 100);

  const seedIds = seedTrackIds(opts.type, opts.id, opts.userId);
  if (seedIds.length === 0) return [];
  // A single song is already playing (the client has it); for an artist, album or playlist the seed
  // tracks are exactly the kind of music wanted, so only what the caller lists is held back.
  const excluded = new Set<number>([...(opts.type === 'song' ? seedIds : []), ...(opts.exclude ?? [])]);

  // ── what the seeds look like ──
  const seeds = db
    .prepare(
      `SELECT t.artist_id AS artistId, t.genre, al.year FROM tracks t JOIN albums al ON al.id = t.album_id
       WHERE t.id IN (${placeholders(seedIds.length)})`,
    )
    .all(...seedIds) as { artistId: number; genre: string | null; year: number | null }[];
  const seedArtists = new Set(seeds.map((s) => s.artistId));
  const seedGenres = new Set(seeds.map((s) => s.genre).filter((g): g is string => !!g));
  const years = seeds.map((s) => s.year).filter((y): y is number => !!y).sort((a, b) => a - b);
  const seedYear = years.length ? years[Math.floor(years.length / 2)] : null;
  const similarArtists = new Set(opts.similarArtistIds ?? []);

  // ── co-listening ──
  const coListen = new Map<number, number>();
  const seedSample = seedIds.slice(0, 40);
  const co = db
    .prepare(
      `SELECT ph2.track_id AS id, COUNT(*) AS c
       FROM play_history ph1
       JOIN play_history ph2 ON ph2.user_id = ph1.user_id AND ph2.track_id != ph1.track_id
            AND ph2.played_at BETWEEN ph1.played_at - ? AND ph1.played_at + ?
       WHERE ph1.track_id IN (${placeholders(seedSample.length)})
       GROUP BY ph2.track_id ORDER BY c DESC LIMIT 300`,
    )
    .all(CO_LISTEN_WINDOW_S, CO_LISTEN_WINDOW_S, ...seedSample) as { id: number; c: number }[];
  const maxCo = Math.max(1, ...co.map((r) => r.c));
  for (const r of co) coListen.set(r.id, r.c / maxCo);

  // ── candidates: anything related, topped up with random tracks so a sparse library still works ──
  const conditions: string[] = [];
  const params: unknown[] = [opts.userId, opts.userId];
  if (seedArtists.size) { conditions.push(`t.artist_id IN (${placeholders(seedArtists.size)})`); params.push(...seedArtists); }
  if (similarArtists.size) { conditions.push(`t.artist_id IN (${placeholders(similarArtists.size)})`); params.push(...similarArtists); }
  if (seedGenres.size) { conditions.push(`t.genre IN (${placeholders(seedGenres.size)})`); params.push(...seedGenres); }
  if (coListen.size) { conditions.push(`t.id IN (${placeholders(coListen.size)})`); params.push(...coListen.keys()); }
  if (seedYear) { conditions.push('al.year BETWEEN ? AND ?'); params.push(seedYear - 6, seedYear + 6); }

  const candidateSql = (where: string) => `
    SELECT t.id, t.artist_id AS artistId, t.album_id AS albumId, t.genre, al.year,
           (f.created_at IS NOT NULL) AS starred,
           (SELECT COUNT(*) FROM play_history WHERE user_id = ? AND track_id = t.id) AS plays,
           (SELECT MAX(played_at) FROM play_history WHERE user_id = ? AND track_id = t.id) AS lastPlayed
    FROM tracks t JOIN albums al ON al.id = t.album_id
    LEFT JOIN favorites f ON f.item_type = 'track' AND f.item_id = t.id AND f.user_id = ${'' + opts.userId}
    ${where}`;

  const byRelation = conditions.length
    ? (db.prepare(`${candidateSql(`WHERE (${conditions.join(' OR ')})`)} ORDER BY RANDOM() LIMIT ${MAX_CANDIDATES}`).all(...params) as Candidate[])
    : [];
  const pool = new Map<number, Candidate>();
  for (const c of byRelation) pool.set(c.id, { ...c, starred: !!c.starred });
  if (pool.size < count * 3) {
    const filler = db
      .prepare(`${candidateSql('')} ORDER BY RANDOM() LIMIT ${count * 6}`)
      .all(opts.userId, opts.userId) as Candidate[];
    for (const c of filler) if (!pool.has(c.id)) pool.set(c.id, { ...c, starred: !!c.starred });
  }

  // ── score ──
  const scored = [...pool.values()]
    .filter((c) => !excluded.has(c.id))
    .map((c) => {
      let score = 0;
      if (seedArtists.has(c.artistId)) score += 3;
      if (similarArtists.has(c.artistId)) score += 2.5;
      if (c.genre && seedGenres.has(c.genre)) score += 2;
      if (seedYear && c.year) {
        const gap = Math.abs(c.year - seedYear);
        score += gap <= 3 ? 1.5 : gap <= 8 ? 0.8 : 0;
      }
      score += (coListen.get(c.id) ?? 0) * 5;
      if (c.starred) score += 1;
      score += Math.min(1.2, Math.log1p(c.plays) * 0.5);
      if (c.lastPlayed && now - c.lastPlayed < RECENT_PENALTY_S) score -= 2.5;
      score += rand() * 1.5; // a little shake so every radio run differs
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);

  // ── diversity ──
  // Pick one at a time: the best-scoring song that neither repeats the previous artist nor pushes an
  // artist past its share. If variety runs out (a small library), relax the rules rather than return too few.
  const perArtistCap = Math.max(3, Math.ceil(count / 3));
  const remaining = scored.map((x) => x.c);
  const picked: Candidate[] = [];
  const perArtist = new Map<number, number>();
  while (picked.length < count && remaining.length > 0) {
    const last = picked[picked.length - 1];
    let index = remaining.findIndex((c) => c.artistId !== last?.artistId && (perArtist.get(c.artistId) ?? 0) < perArtistCap);
    if (index === -1) index = remaining.findIndex((c) => (perArtist.get(c.artistId) ?? 0) < perArtistCap);
    if (index === -1) index = 0;
    const [chosen] = remaining.splice(index, 1);
    picked.push(chosen);
    perArtist.set(chosen.artistId, (perArtist.get(chosen.artistId) ?? 0) + 1);
  }

  if (picked.length === 0) return [];
  const rows = db
    .prepare(`SELECT ${SONG_SELECT_LIST}${SONG_FROM} WHERE t.id IN (${placeholders(picked.length)})`)
    .all(opts.userId, ...picked.map((c) => c.id)) as SongRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return picked.map((c) => byId.get(c.id)).filter((r): r is SongRow => !!r);
}

/** What an id from a Subsonic client refers to — artist, album and song ids share one counter, so any one matches at most one table. */
export function resolveSeedType(id: number): RadioSeedType | null {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(id)) return 'song';
  if (db.prepare('SELECT 1 FROM albums WHERE id = ?').get(id)) return 'album';
  if (db.prepare('SELECT 1 FROM artists WHERE id = ?').get(id)) return 'artist';
  return null;
}

/** The artists behind a seed (for asking a similarity service about them). */
export function seedArtistIds(type: RadioSeedType, id: number, userId: number): number[] {
  const ids = seedTrackIds(type, id, userId);
  if (!ids.length) return [];
  const rows = getDb()
    .prepare(`SELECT DISTINCT artist_id AS id FROM tracks WHERE id IN (${placeholders(ids.length)}) LIMIT 5`)
    .all(...ids) as { id: number }[];
  return rows.map((r) => r.id);
}
