import { getDb } from '../db/database.js';
import { fetchSimilarArtistNames, fetchTopTrackNames, getUserTopArtists } from './lastfm.js';

// Weekly discovery: artists (and one well-known track each) that the user does NOT have yet, inferred
// from who they listen to — the Last.fm "similar artists" of their top artists, minus everything already
// in the library. HARD RULE (CLAUDE.md principle 2): names only. No link, no source, no way to obtain
// anything is ever produced here; the UI just says "you might like".

export interface DiscoveryItem {
  artist: string;
  /** A popular track by that artist, when Last.fm named one. */
  track?: string;
  /** The user's own top artists this suggestion came from. */
  because: string[];
}

export type WeeklyState =
  | { status: 'ok'; week: string; items: DiscoveryItem[] }
  | { status: 'not_configured' } // no Last.fm key
  | { status: 'no_history' }; // nothing played lately to base it on

const TOP_ARTISTS = 8;
const MAX_ITEMS = 15;

/** Monday (UTC) of the week containing [date], as YYYY-MM-DD. */
export function weekStart(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

// Last.fm text is untrusted: plain, short strings only.
function clean(value: string): string {
  return [...value].map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function getKey(): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get() as { value: string } | undefined;
  return row?.value || null;
}

export function readWeek(userId: number, week: string): DiscoveryItem[] | null {
  const row = getDb().prepare('SELECT items FROM weekly_discovery WHERE user_id = ? AND week = ?').get(userId, week) as
    | { items: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.items) as DiscoveryItem[];
  } catch {
    return null;
  }
}

/** Builds this week's list from Last.fm and stores it (replacing any earlier one for the week). */
export async function generateWeek(userId: number, week: string, random: () => number = Math.random): Promise<WeeklyState> {
  const key = getKey();
  if (!key) return { status: 'not_configured' };
  const top = getUserTopArtists(userId, 90, TOP_ARTISTS);
  if (top.length === 0) return { status: 'no_history' };

  const db = getDb();
  const inLibrary = new Set((db.prepare('SELECT LOWER(name) AS n FROM artists').all() as { n: string }[]).map((r) => r.n));

  // candidate artist → which of the user's artists point at it, and how high Last.fm ranks it
  const candidates = new Map<string, { name: string; because: Set<string>; rank: number }>();
  for (const { name: topName } of top) {
    let similar: string[] = [];
    try {
      similar = await fetchSimilarArtistNames(topName, key);
    } catch {
      continue; // one failing lookup must not sink the whole list
    }
    similar.forEach((raw, rank) => {
      const name = clean(raw);
      const lower = name.toLowerCase();
      if (!name || inLibrary.has(lower)) return;
      const c = candidates.get(lower) ?? { name, because: new Set<string>(), rank: 0 };
      c.because.add(topName);
      c.rank += 10 - Math.min(rank, 9);
      candidates.set(lower, c);
    });
  }

  // Suggested by several of the user's artists first, then by Last.fm's own ranking; a little shuffle so weeks differ.
  const ranked = [...candidates.values()]
    .map((c) => ({ c, score: c.because.size * 20 + c.rank + random() * 6 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ITEMS)
    .map((x) => x.c);

  const items: DiscoveryItem[] = [];
  for (const c of ranked) {
    let track: string | undefined;
    try {
      const names = (await fetchTopTrackNames(c.name, key, 3)).map(clean).filter(Boolean);
      if (names.length) track = names[Math.floor(random() * names.length)];
    } catch {
      // a suggestion without a named track is still a suggestion
    }
    items.push({ artist: c.name, track, because: [...c.because].map(clean).slice(0, 3) });
  }

  db.prepare(
    `INSERT INTO weekly_discovery (user_id, week, items) VALUES (?, ?, ?)
     ON CONFLICT(user_id, week) DO UPDATE SET items = excluded.items, created_at = unixepoch()`,
  ).run(userId, week, JSON.stringify(items));
  // Old weeks aren't kept: only this week is ever shown.
  db.prepare('DELETE FROM weekly_discovery WHERE user_id = ? AND week < ?').run(userId, week);
  return { status: 'ok', week, items };
}

/** This week's list: the stored one, or a freshly built one the first time it is asked for in a week. */
export async function getWeekly(userId: number, now = new Date(), random?: () => number): Promise<WeeklyState> {
  const week = weekStart(now);
  const stored = readWeek(userId, week);
  if (stored) return { status: 'ok', week, items: stored };
  return generateWeek(userId, week, random);
}
