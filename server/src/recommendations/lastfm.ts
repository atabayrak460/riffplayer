/**
 * Last.fm-based similar-artist recommendations.
 * Finds the user's top artists from play_history, calls Last.fm getSimilar,
 * then matches returned names against the local library.
 *
 * HARD RULE: only tracks already in the user's library are returned.
 * No external links or acquisition paths are ever provided.
 */
import { createHash } from 'crypto';
import { getDb } from '../db/database.js';
import { escapeLike } from '../db/likeEscape.js';
import { toFts5Phrase } from '../db/fts5Escape.js';
import { TtlCache } from './ttlCache.js';
import { SONG_SELECT_LIST, SONG_FROM } from '../routes/subsonic/endpoints/browse.js';
import type { SongRow } from '../routes/subsonic/serialize.js';

// See search.ts's identical constant/comment — trigram FTS5 can't tokenize
// anything shorter than this.
const MIN_FTS_QUERY_LENGTH = 3;

interface TopArtist {
  name: string;
  play_count: number;
}

export function getUserTopArtists(userId: number, limitDays = 90, count = 5): TopArtist[] {
  const since = Math.floor(Date.now() / 1000) - limitDays * 86400;
  return getDb()
    .prepare(`
      SELECT ar.name, COUNT(ph.id) AS play_count
      FROM play_history ph
      JOIN tracks t ON t.id = ph.track_id
      JOIN artists ar ON ar.id = t.artist_id
      WHERE ph.user_id = ? AND ph.played_at >= ?
      GROUP BY ar.id
      ORDER BY play_count DESC
      LIMIT ?
    `)
    .all(userId, since, count) as TopArtist[];
}

export async function fetchSimilarArtistNames(
  artistName: string,
  apiKey: string,
): Promise<string[]> {
  const params = new URLSearchParams({
    method: 'artist.getSimilar',
    artist: artistName,
    api_key: apiKey,
    format: 'json',
    limit: '10',
  });
  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    similarartists?: { artist?: Array<{ name: string }> };
  };
  return (data.similarartists?.artist ?? []).map((a) => a.name);
}

/** The names of an artist's most popular tracks (Last.fm). Names only. */
export async function fetchTopTrackNames(artistName: string, apiKey: string, limit = 3): Promise<string[]> {
  const params = new URLSearchParams({
    method: 'artist.getTopTracks',
    artist: artistName,
    api_key: apiKey,
    format: 'json',
    limit: String(limit),
  });
  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { toptracks?: { track?: Array<{ name: string }> } };
  return (data.toptracks?.track ?? []).map((t) => t.name);
}

function findLocalTracksByArtistName(artistName: string, limit = 3): SongRow[] {
  const useFts = artistName.length >= MIN_FTS_QUERY_LENGTH;
  const where = useFts
    ? 'JOIN artists_fts ON artists_fts.rowid = ar.id WHERE artists_fts MATCH ?'
    : "WHERE ar.name LIKE ? ESCAPE '\\'";
  const matchArg = useFts ? toFts5Phrase(artistName) : `%${escapeLike(artistName)}%`;

  return getDb()
    .prepare(`
      SELECT ${SONG_SELECT_LIST}${SONG_FROM}
      ${where}
      ORDER BY RANDOM()
      LIMIT ?
    `)
    // No signed-in user for a "starred" flag here — bound NULL never
    // matches favorites.user_id, so f.created_at (and therefore starred)
    // comes back NULL for every row, same as the old NULL-literal version.
    .all(null, matchArg, limit) as SongRow[];
}

// Capped at 500 entries so it can never grow unboundedly on a long-running,
// multi-user server — comfortably above any realistic self-hosted user
// count, so eviction never kicks in during normal use.
const _cache = new TtlCache<SongRow[]>(6 * 60 * 60 * 1000, 500);

/** Folds a fingerprint of the API key into the cache key (hashed, not
 * stored raw) so rotating it invalidates any stale cached recommendations
 * immediately, instead of serving results computed under the old key for
 * up to the full TTL. */
function cacheKeyFor(userId: number, apiKey: string): string {
  const fingerprint = createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
  return `lfm:${userId}:${fingerprint}`;
}

export async function getLastFmRecommendations(
  userId: number,
  apiKey: string,
): Promise<SongRow[]> {
  const cacheKey = cacheKeyFor(userId, apiKey);
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const topArtists = getUserTopArtists(userId, 90, 5);
  if (!topArtists.length) return [];

  const similarNames = new Set<string>();
  for (const { name } of topArtists) {
    const similar = await fetchSimilarArtistNames(name, apiKey);
    similar.forEach((n) => similarNames.add(n));
  }

  // Exclude artists the user already listens to
  const knownNames = new Set(topArtists.map((a) => a.name.toLowerCase()));
  const candidates = [...similarNames].filter(
    (n) => !knownNames.has(n.toLowerCase()),
  );

  // Find local matches
  const songs: SongRow[] = [];
  const seen = new Set<number>();
  for (const name of candidates) {
    for (const song of findLocalTracksByArtistName(name, 3)) {
      if (!seen.has(song.id)) { seen.add(song.id); songs.push(song); }
    }
    if (songs.length >= 30) break;
  }

  // Shuffle before caching
  for (let i = songs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [songs[i], songs[j]] = [songs[j], songs[i]];
  }

  _cache.set(cacheKey, songs);
  return songs;
}
