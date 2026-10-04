import { getDb } from '../db/database.js';
import { normaliseName } from '../import/normalise.js';

export interface WrappedStats {
  year: number;
  totalPlays: number;
  totalMinutes: number;
  topTracks: {
    id: string;
    title: string;
    artist: string;
    artistId: string;
    album: string;
    albumId: string;
    coverArt: string | null;
    playCount: number;
    /** True when the song is not in this library (it comes from imported listening history). */
    external?: boolean;
  }[];
  topArtists: {
    id: string;
    name: string;
    coverArt: string | null;
    playCount: number;
    external?: boolean;
  }[];
  topAlbums: {
    id: string;
    name: string;
    artist: string;
    coverArt: string | null;
    playCount: number;
    external?: boolean;
  }[];
  /** How many of totalPlays came from imported history (Spotify, Apple Music, Last.fm). */
  importedPlays: number;
  byMonth: { month: number; plays: number }[];
}

function yearBounds(year: number): [number, number] {
  const start = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
  const end = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000);
  return [start, end];
}

interface PlayRow {
  played_at: number;
  secs: number;
  imported: number;
  track_id: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  lib_title: string | null;
  artist_id: number | null;
  lib_artist: string | null;
  image_path: string | null;
  album_id: number | null;
  lib_album: string | null;
  album_artist: string | null;
}

interface Counter<T> {
  info: T;
  plays: number;
}

function bump<T>(map: Map<string, Counter<T>>, key: string, info: () => T): void {
  const hit = map.get(key);
  if (hit) hit.plays++;
  else map.set(key, { info: info(), plays: 1 });
}

function top<T>(map: Map<string, Counter<T>>): Counter<T>[] {
  return [...map.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);
}

/**
 * Plays inside RiffPlayer plus plays imported from other services. Imported plays whose song is in
 * the library merge into that song; the rest are counted by name and marked `external`.
 */
export function getWrappedStats(userId: number, year: number): WrappedStats {
  const db = getDb();
  const [start, end] = yearBounds(year);

  const detail = `
    t.title AS lib_title, ar.id AS artist_id, ar.name AS lib_artist, ar.image_path,
    al.id AS album_id, al.name AS lib_album, aa.name AS album_artist
    FROM %SRC% x
    LEFT JOIN tracks t ON t.id = x.track_id
    LEFT JOIN artists ar ON ar.id = t.artist_id
    LEFT JOIN albums al ON al.id = t.album_id
    LEFT JOIN artists aa ON aa.id = al.artist_id
    WHERE x.user_id = ? AND x.played_at >= ? AND x.played_at < ?`;
  const rows = [
    ...(db
      .prepare(`SELECT x.played_at, COALESCE(t.duration_s, 0) AS secs, 0 AS imported, x.track_id,
                       NULL AS title, NULL AS artist, NULL AS album, ${detail.replace('%SRC%', 'play_history')}`)
      .all(userId, start, end) as PlayRow[]),
    ...(db
      .prepare(`SELECT x.played_at, x.duration_ms / 1000.0 AS secs, 1 AS imported, x.track_id,
                       x.title, x.artist, x.album, ${detail.replace('%SRC%', 'external_plays')}`)
      .all(userId, start, end) as PlayRow[]),
  ];

  const libraryArtists = new Map<string, { id: number; name: string; image: string | null }>();
  for (const a of db.prepare('SELECT id, name, image_path FROM artists').all() as { id: number; name: string; image_path: string | null }[]) {
    const key = normaliseName(a.name);
    if (!libraryArtists.has(key)) libraryArtists.set(key, { id: a.id, name: a.name, image: a.image_path });
  }

  const tracks = new Map<string, Counter<WrappedStats['topTracks'][number]>>();
  const artists = new Map<string, Counter<WrappedStats['topArtists'][number]>>();
  const albums = new Map<string, Counter<WrappedStats['topAlbums'][number]>>();
  const months = new Map<number, number>();
  let secs = 0;
  let imported = 0;

  for (const r of rows) {
    secs += r.secs;
    if (r.imported) imported++;
    const month = new Date(r.played_at * 1000).getUTCMonth() + 1;
    months.set(month, (months.get(month) ?? 0) + 1);

    const inLibrary = r.track_id !== null && r.lib_title !== null;
    if (inLibrary) {
      bump(tracks, `t:${r.track_id}`, () => ({
        id: String(r.track_id), title: r.lib_title!, artist: r.lib_artist!, artistId: String(r.artist_id),
        album: r.lib_album!, albumId: String(r.album_id), coverArt: `al-${r.album_id}`, playCount: 0,
      }));
      bump(artists, `a:${r.artist_id}`, () => ({
        id: String(r.artist_id), name: r.lib_artist!, coverArt: r.image_path ? `ar-${r.artist_id}` : null, playCount: 0,
      }));
      bump(albums, `al:${r.album_id}`, () => ({
        id: String(r.album_id), name: r.lib_album!, artist: r.album_artist ?? r.lib_artist!, coverArt: `al-${r.album_id}`, playCount: 0,
      }));
      continue;
    }

    // Not in this library: count by name, joining a library artist of the same name when there is one.
    const artistName = r.artist ?? '';
    const artistKey = normaliseName(artistName);
    const lib = libraryArtists.get(artistKey);
    bump(tracks, `x:${artistKey}|${normaliseName(r.title ?? '')}`, () => ({
      id: '', title: r.title ?? '', artist: artistName, artistId: lib ? String(lib.id) : '',
      album: r.album ?? '', albumId: '', coverArt: null, playCount: 0, external: true,
    }));
    if (lib) {
      bump(artists, `a:${lib.id}`, () => ({
        id: String(lib.id), name: lib.name, coverArt: lib.image ? `ar-${lib.id}` : null, playCount: 0,
      }));
    } else {
      bump(artists, `x:${artistKey}`, () => ({ id: '', name: artistName, coverArt: null, playCount: 0, external: true }));
    }
    if (r.album) {
      bump(albums, `x:${artistKey}|${normaliseName(r.album)}`, () => ({
        id: '', name: r.album!, artist: artistName, coverArt: null, playCount: 0, external: true,
      }));
    }
  }

  const withCount = <T extends { playCount: number }>(c: Counter<T>): T => ({ ...c.info, playCount: c.plays });
  return {
    year,
    totalPlays: rows.length,
    totalMinutes: Math.round(secs / 60),
    topTracks: top(tracks).map(withCount),
    topArtists: top(artists).map(withCount),
    topAlbums: top(albums).map(withCount),
    importedPlays: imported,
    byMonth: [...months.entries()].sort((a, b) => a[0] - b[0]).map(([month, plays]) => ({ month, plays })),
  };
}
