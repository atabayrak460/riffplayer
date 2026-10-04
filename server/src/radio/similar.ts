import { getDb } from '../db/database.js';
import { fetchSimilarArtistNames } from '../recommendations/lastfm.js';
import { TtlCache } from '../recommendations/ttlCache.js';

// Optional Last.fm bonus for the radio: artists Last.fm rates close to the seed artists, matched by
// NAME against this library. It needs the admin's Last.fm key (the same one Discover uses) and
// never blocks or breaks the radio — no key, a timeout or an error just means no bonus.

const cache = new TtlCache<number[]>(6 * 60 * 60 * 1000, 300);

export async function similarLibraryArtistIds(seedArtistIds: number[]): Promise<number[]> {
  const db = getDb();
  const key = (db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get() as { value: string } | undefined)?.value;
  if (!key || seedArtistIds.length === 0) return [];

  const out = new Set<number>();
  for (const artistId of seedArtistIds.slice(0, 3)) {
    const cacheKey = `similar:${artistId}`;
    let ids = cache.get(cacheKey);
    if (!ids) {
      ids = [];
      try {
        const name = (db.prepare('SELECT name FROM artists WHERE id = ?').get(artistId) as { name: string } | undefined)?.name;
        const similar = name ? await fetchSimilarArtistNames(name, key) : [];
        if (similar.length) {
          const rows = db
            .prepare(`SELECT id FROM artists WHERE LOWER(name) IN (${similar.map(() => '?').join(',')})`)
            .all(...similar.map((n) => n.toLowerCase())) as { id: number }[];
          ids = rows.map((r) => r.id);
        }
      } catch {
        ids = []; // offline / rate limited — radio works without the bonus
      }
      cache.set(cacheKey, ids);
    }
    ids.forEach((i) => out.add(i));
  }
  return [...out];
}
