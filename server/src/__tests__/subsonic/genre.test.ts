import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { seedLibrary, authParams } from './helpers.js';

let app: FastifyInstance;
let ids: ReturnType<typeof seedLibrary>;
let otherAlbumId: number;
let otherTrackId: number;

beforeEach(async () => {
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  ids = seedLibrary(getDb());

  const db = getDb();
  db.prepare("UPDATE tracks SET genre = 'Rock' WHERE id = ?").run(ids.trackId);

  otherAlbumId = Number(
    db.prepare("INSERT INTO albums (name, artist_id, year) VALUES ('Other Album', ?, 2020)")
      .run(ids.artistId).lastInsertRowid,
  );
  otherTrackId = Number(
    db.prepare(`
      INSERT INTO tracks (title, album_id, artist_id, track_no, duration_s, path, size, format, bitrate, genre)
      VALUES ('Other Track', ?, ?, 1, 180, '/music/other.mp3', 512000, 'MPEG', 128, 'Jazz')
    `).run(otherAlbumId, ids.artistId).lastInsertRowid,
  );
});

afterEach(async () => {
  await app.close();
  closeDb();
});

const auth = authParams();

function sr(body: string) {
  return (JSON.parse(body) as Record<string, Record<string, unknown>>)['subsonic-response'];
}

describe('getGenres', () => {
  it('returns distinct genres with song/album counts', async () => {
    const res = await app.inject({ url: `/rest/getGenres.view?${auth}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const genres = (r.genres as Record<string, unknown[]>).genre as Record<string, unknown>[];
    expect(genres).toEqual(
      expect.arrayContaining([
        { value: 'Rock', songCount: 1, albumCount: 1 },
        { value: 'Jazz', songCount: 1, albumCount: 1 },
      ]),
    );
  });

  it('excludes tracks with no genre set', async () => {
    const db = getDb();
    db.prepare("INSERT INTO tracks (title, album_id, artist_id, track_no, duration_s, path, size, format, bitrate) VALUES ('No Genre', ?, ?, 2, 100, '/music/nogenre.mp3', 1, 'MPEG', 128)")
      .run(ids.albumId, ids.artistId);

    const res = await app.inject({ url: `/rest/getGenres.view?${auth}` });
    const genres = (sr(res.body).genres as Record<string, unknown[]>).genre as Record<string, unknown>[];
    expect(genres.length).toBe(2); // still just Rock and Jazz, not a third "null" bucket
  });
});

describe('getRandomSongs genre filter', () => {
  it('returns only songs matching the given genre', async () => {
    const res = await app.inject({ url: `/rest/getRandomSongs.view?${auth}&genre=Jazz` });
    const r = sr(res.body);
    const songs = (r.randomSongs as Record<string, unknown[]>).song as Record<string, unknown>[];
    expect(songs.length).toBe(1);
    expect(songs[0].id).toBe(String(otherTrackId));
  });

  it('returns nothing for a genre no track has', async () => {
    const res = await app.inject({ url: `/rest/getRandomSongs.view?${auth}&genre=Classical` });
    const songs = (sr(res.body).randomSongs as Record<string, unknown[]>).song;
    expect(songs.length).toBe(0);
  });
});

describe('getAlbumList2 type=byGenre', () => {
  it('returns MISSING_PARAM when genre is absent', async () => {
    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=byGenre` });
    const r = sr(res.body);
    expect(r.status).toBe('failed');
    expect((r.error as Record<string, unknown>).code).toBe(10);
  });

  it('returns only albums containing a track with the given genre', async () => {
    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=byGenre&genre=Rock` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const albums = (r.albumList2 as Record<string, unknown[]>).album as Record<string, unknown>[];
    expect(albums.length).toBe(1);
    expect(albums[0].id).toBe(String(ids.albumId));
  });

  it("doesn't undercount songCount for a mixed-genre album matched by only one of its tracks", async () => {
    // ids.albumId now has 2 tracks: the Rock one from beforeEach, plus this
    // second, genre-less one — songCount must still reflect both, not just
    // the one that matched the byGenre filter.
    getDb().prepare(`
      INSERT INTO tracks (title, album_id, artist_id, track_no, duration_s, path, size, format, bitrate)
      VALUES ('Second Track', ?, ?, 2, 150, '/music/second.mp3', 1, 'MPEG', 128)
    `).run(ids.albumId, ids.artistId);

    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=byGenre&genre=Rock` });
    const albums = (sr(res.body).albumList2 as Record<string, unknown[]>).album as Record<string, unknown>[];
    expect(albums.length).toBe(1);
    expect(albums[0].songCount).toBe(2);
  });
});

describe('search3 genre filter and sort', () => {
  const songsOf = (body: string) =>
    ((sr(body).searchResult3 as Record<string, unknown[]>).song ?? []) as Record<string, unknown>[];

  it('returns only songs of the given genre', async () => {
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=&songCount=50&genre=Jazz` });
    const songs = songsOf(res.body);
    expect(songs.map((s) => s.id)).toEqual([String(otherTrackId)]);
  });

  it('never matches a genre-less track', async () => {
    getDb().prepare('UPDATE tracks SET genre = NULL WHERE id = ?').run(otherTrackId);
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=&songCount=50&genre=Jazz` });
    expect(songsOf(res.body)).toEqual([]);
  });

  it('sorts by date added, newest or oldest first', async () => {
    getDb().prepare('UPDATE tracks SET added_at = 1000 WHERE id = ?').run(ids.trackId);
    getDb().prepare('UPDATE tracks SET added_at = 2000 WHERE id = ?').run(otherTrackId);
    const newest = await app.inject({ url: `/rest/search3.view?${auth}&query=&songCount=50&sort=added_desc` });
    expect(songsOf(newest.body)[0].id).toBe(String(otherTrackId));
    const oldest = await app.inject({ url: `/rest/search3.view?${auth}&query=&songCount=50&sort=added_asc` });
    expect(songsOf(oldest.body)[0].id).toBe(String(ids.trackId));
  });
});

describe('audio format fields on songs', () => {
  it('exposes OpenSubsonic samplingRate/bitDepth/channelCount plus codec and lossless', async () => {
    getDb().prepare(
      "UPDATE tracks SET sample_rate = 96000, bit_depth = 24, channels = 2, codec = 'FLAC', lossless = 1 WHERE id = ?",
    ).run(ids.trackId);
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=&songCount=50&genre=Rock` });
    const song = (sr(res.body).searchResult3 as Record<string, Record<string, unknown>[]>).song[0];
    expect(song.samplingRate).toBe(96000);
    expect(song.bitDepth).toBe(24);
    expect(song.channelCount).toBe(2);
    expect(song.codec).toBe('FLAC');
    expect(song.lossless).toBe(true);
  });

  it('omits them when unknown instead of inventing values', async () => {
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=&songCount=50&genre=Rock` });
    const song = (sr(res.body).searchResult3 as Record<string, Record<string, unknown>[]>).song[0];
    expect(song).not.toHaveProperty('bitDepth');
    expect(song).not.toHaveProperty('lossless');
  });
});
