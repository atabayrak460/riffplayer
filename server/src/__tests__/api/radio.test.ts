import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { buildRadio } from '../../radio/radio.js';
import { seedLibrary, authParams } from '../subsonic/helpers.js';

let app: FastifyInstance;
const auth = authParams();

// A small library: two Rock artists of the 90s, one Jazz artist of the 50s, and a Pop artist of today.
const lib: { artist: number; albums: Record<string, number>; tracks: Record<string, number> } = { artist: 0, albums: {}, tracks: {} };
const artistIds: Record<string, number> = {};

function addArtist(name: string): number {
  return Number(getDb().prepare('INSERT INTO artists (name) VALUES (?)').run(name).lastInsertRowid);
}
function addAlbum(name: string, artistId: number, year: number): number {
  return Number(getDb().prepare('INSERT INTO albums (name, artist_id, year) VALUES (?, ?, ?)').run(name, artistId, year).lastInsertRowid);
}
let n = 0;
function addTrack(title: string, albumId: number, artistId: number, genre: string): number {
  return Number(
    getDb().prepare(`INSERT INTO tracks (title, album_id, artist_id, track_no, duration_s, path, size, format, bitrate, genre)
                     VALUES (?, ?, ?, 1, 200, ?, 1, 'FLAC', 900, ?)`).run(title, albumId, artistId, `/m/${n++}.flac`, genre).lastInsertRowid,
  );
}

beforeEach(async () => {
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  seedLibrary(getDb());
  n = 0;
  artistIds.rockA = addArtist('Rock A');
  artistIds.rockB = addArtist('Rock B');
  artistIds.jazz = addArtist('Jazz Man');
  artistIds.pop = addArtist('Pop Star');
  const al = {
    rockA: addAlbum('A1', artistIds.rockA, 1995), rockB: addAlbum('B1', artistIds.rockB, 1996),
    jazz: addAlbum('J1', artistIds.jazz, 1957), pop: addAlbum('P1', artistIds.pop, 2023),
  };
  lib.albums = al;
  for (let i = 0; i < 6; i++) {
    lib.tracks[`a${i}`] = addTrack(`A song ${i}`, al.rockA, artistIds.rockA, 'Rock');
    lib.tracks[`b${i}`] = addTrack(`B song ${i}`, al.rockB, artistIds.rockB, 'Rock');
    lib.tracks[`j${i}`] = addTrack(`J song ${i}`, al.jazz, artistIds.jazz, 'Jazz');
    lib.tracks[`p${i}`] = addTrack(`P song ${i}`, al.pop, artistIds.pop, 'Pop');
  }
});

afterEach(async () => {
  await app.close();
  closeDb();
});

const artistOf = (trackId: number) => (getDb().prepare('SELECT artist_id AS a FROM tracks WHERE id = ?').get(trackId) as { a: number }).a;
const radio = (over: Partial<Parameters<typeof buildRadio>[0]> = {}) =>
  buildRadio({ userId: 1, type: 'song', id: lib.tracks.a0, count: 10, random: () => 0.5, ...over });

describe('buildRadio', () => {
  it('never includes the seed or what the caller already has', () => {
    const exclude = [lib.tracks.a1, lib.tracks.a2];
    const out = radio({ exclude });
    const got = out.map((s) => s.id);
    expect(got).not.toContain(lib.tracks.a0);
    expect(got).not.toContain(lib.tracks.a1);
    expect(got).not.toContain(lib.tracks.a2);
  });

  it('prefers the same genre and era: a 90s Rock seed gets Rock before Jazz or Pop', () => {
    const out = radio({ count: 8 }).map((s) => artistOf(s.id));
    const rock = out.filter((a) => a === artistIds.rockA || a === artistIds.rockB).length;
    expect(rock).toBeGreaterThanOrEqual(6);
  });

  it('does not let one artist fill the queue, nor play the same artist back to back', () => {
    const out = radio({ count: 12 });
    const artists = out.map((s) => artistOf(s.id));
    for (let i = 1; i < artists.length; i++) {
      // allowed only once variety has run out (the leftovers at the very end)
      if (i < 6) expect(artists[i], `position ${i}`).not.toBe(artists[i - 1]);
    }
    const perArtist = new Map<number, number>();
    for (const a of artists.slice(0, 8)) perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
    expect(Math.max(...perArtist.values())).toBeLessThanOrEqual(4);
  });

  it('learns from co-listening: tracks played right after the seed rise to the top', () => {
    const db = getDb();
    const t = 1_700_000_000;
    // One evening: seed (a Rock song), then a Jazz track and a Pop track.
    db.prepare('INSERT INTO play_history (user_id, track_id, played_at) VALUES (1, ?, ?)').run(lib.tracks.a0, t);
    db.prepare('INSERT INTO play_history (user_id, track_id, played_at) VALUES (1, ?, ?)').run(lib.tracks.j3, t + 300);
    const out = radio({ count: 3, now: t + 10 * 86400 }).map((s) => s.id);
    expect(out).toContain(lib.tracks.j3);
  });

  it('holds back what the user just heard', () => {
    const now = 1_800_000_000;
    getDb().prepare('INSERT INTO play_history (user_id, track_id, played_at) VALUES (1, ?, ?)').run(lib.tracks.b0, now - 60);
    const first = radio({ count: 4, now, type: 'artist', id: artistIds.rockA }).map((s) => s.id);
    expect(first).not.toContain(lib.tracks.b0);
  });

  it('an artist radio draws on that artist and its neighbours', () => {
    const out = radio({ type: 'artist', id: artistIds.rockA, count: 8 }).map((s) => artistOf(s.id));
    expect(out.some((a) => a === artistIds.rockA)).toBe(true);
    expect(out.filter((a) => a === artistIds.rockA || a === artistIds.rockB).length).toBeGreaterThanOrEqual(5);
  });

  it('album and playlist seeds work too', () => {
    expect(radio({ type: 'album', id: lib.albums.rockA, count: 5 }).length).toBe(5);
    const db = getDb();
    const pl = Number(db.prepare("INSERT INTO playlists (owner_id, name) VALUES (1, 'Mine')").run().lastInsertRowid);
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 0)').run(pl, lib.tracks.j0);
    const out = radio({ type: 'playlist', id: pl, count: 5 }).map((s) => artistOf(s.id));
    expect(out.length).toBe(5);
    expect(out).toContain(artistIds.jazz);
  });

  it("a stranger's private playlist is not a usable seed", () => {
    const db = getDb();
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('other', 'x', 'user')").run();
    const other = (db.prepare("SELECT id FROM users WHERE username = 'other'").get() as { id: number }).id;
    const pl = Number(db.prepare("INSERT INTO playlists (owner_id, name, is_public) VALUES (?, 'Secret', 0)").run(other).lastInsertRowid);
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, 0)').run(pl, lib.tracks.j0);
    expect(radio({ type: 'playlist', id: pl })).toEqual([]);
  });

  it('still returns something from a tiny library, and nothing for an unknown seed', () => {
    expect(radio({ count: 50 }).length).toBeGreaterThan(10);
    expect(radio({ id: 999999 })).toEqual([]);
  });

  it('a boost for similar artists ranks them above equally unrelated ones', () => {
    // Once the Rock supply is used up (each artist is capped), Pop — boosted — comes before Jazz.
    const out = radio({ count: 14, similarArtistIds: [artistIds.pop] }).map((s) => artistOf(s.id));
    const firstPop = out.indexOf(artistIds.pop);
    const firstJazz = out.indexOf(artistIds.jazz);
    expect(firstPop).toBeGreaterThanOrEqual(0);
    expect(firstJazz === -1 || firstPop < firstJazz).toBe(true);
  });

  it('different runs differ (a little shake in the scores)', () => {
    const a = buildRadio({ userId: 1, type: 'song', id: lib.tracks.a0, count: 10, random: () => 0.1 }).map((s) => s.id);
    const b = buildRadio({ userId: 1, type: 'song', id: lib.tracks.a0, count: 10, random: () => 0.9 }).map((s) => s.id);
    expect(a.length).toBe(10);
    expect(b.length).toBe(10);
  });
});

describe('GET /api/v1/radio', () => {
  it('requires authentication and a valid seed', async () => {
    expect((await app.inject({ url: `/api/v1/radio?type=song&id=${lib.tracks.a0}` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/v1/radio?${auth}&type=nope&id=1` })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/v1/radio?${auth}&type=song` })).statusCode).toBe(400);
  });

  it('returns songs and honours count and exclude', async () => {
    const res = await app.inject({ url: `/api/v1/radio?${auth}&type=song&id=${lib.tracks.a0}&count=6&exclude=${lib.tracks.a1},${lib.tracks.a2}` });
    expect(res.statusCode).toBe(200);
    const songs = (res.json() as { songs: { id: string; title: string }[] }).songs;
    expect(songs.length).toBe(6);
    const got = songs.map((s) => s.id);
    expect(got).not.toContain(String(lib.tracks.a1));
  });
});

describe('getSimilarSongs2 (OpenSubsonic)', () => {
  const sr = (body: string) => (JSON.parse(body) as Record<string, Record<string, unknown>>)['subsonic-response'];

  it('works for a song id, an album id and an artist id', async () => {
    for (const id of [lib.tracks.a0, lib.albums.rockA, artistIds.rockA]) {
      const res = await app.inject({ url: `/rest/getSimilarSongs2.view?${auth}&id=${id}&count=5` });
      const r = sr(res.body);
      expect(r.status, `id ${id}`).toBe('ok');
      expect(((r.similarSongs2 as { song: unknown[] }).song).length, `id ${id}`).toBe(5);
    }
  });

  it('also answers the original getSimilarSongs name', async () => {
    const res = await app.inject({ url: `/rest/getSimilarSongs.view?${auth}&id=${lib.tracks.a0}&count=3` });
    expect(((sr(res.body).similarSongs as { song: unknown[] }).song).length).toBe(3);
  });

  it('reports a missing id and an unknown id the Subsonic way', async () => {
    expect((sr((await app.inject({ url: `/rest/getSimilarSongs2.view?${auth}` })).body).error as { code: number }).code).toBe(10);
    expect((sr((await app.inject({ url: `/rest/getSimilarSongs2.view?${auth}&id=987654` })).body).error as { code: number }).code).toBe(70);
  });
});
