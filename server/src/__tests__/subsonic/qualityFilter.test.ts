import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { seedLibrary, authParams } from './helpers.js';

let app: FastifyInstance;
let ids: ReturnType<typeof seedLibrary>;
let hiresId: number;
let cdId: number;
let mp3Id: number;
let hiresAlbumId: number;

const auth = authParams();
const json = (body: string) => (JSON.parse(body) as Record<string, Record<string, unknown>>)['subsonic-response'];

function addTrack(albumId: number, title: string, profile: Record<string, number | null>): number {
  const db = getDb();
  const id = Number(
    db.prepare(
      `INSERT INTO tracks (title, album_id, artist_id, track_no, duration_s, path, size, format, bitrate)
       VALUES (?, ?, ?, 1, 100, ?, 1, 'FLAC', 900)`,
    ).run(title, albumId, ids.artistId, `/music/${title}.flac`).lastInsertRowid,
  );
  db.prepare('UPDATE tracks SET bit_depth = ?, sample_rate = ?, lossless = ? WHERE id = ?')
    .run(profile.bit_depth, profile.sample_rate, profile.lossless, id);
  return id;
}

beforeEach(async () => {
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  ids = seedLibrary(getDb()); // its one track keeps lossless = NULL (never profiled)
  const db = getDb();
  hiresAlbumId = Number(db.prepare("INSERT INTO albums (name, artist_id) VALUES ('Hi-Res Album', ?)").run(ids.artistId).lastInsertRowid);
  const cdAlbumId = Number(db.prepare("INSERT INTO albums (name, artist_id) VALUES ('CD Album', ?)").run(ids.artistId).lastInsertRowid);
  hiresId = addTrack(hiresAlbumId, 'HiRes', { bit_depth: 24, sample_rate: 96000, lossless: 1 });
  addTrack(hiresAlbumId, 'HiResPlusCd', { bit_depth: 16, sample_rate: 44100, lossless: 1 });
  cdId = addTrack(cdAlbumId, 'Cd', { bit_depth: 16, sample_rate: 44100, lossless: 1 });
  mp3Id = addTrack(cdAlbumId, 'Mp3', { bit_depth: null, sample_rate: 44100, lossless: 0 });
});

afterEach(async () => {
  await app.close();
  closeDb();
});

async function songIds(qs: string): Promise<string[]> {
  const res = await app.inject({ url: `/rest/search3.view?${auth}&query=&songCount=50&${qs}` });
  const songs = ((json(res.body).searchResult3 as Record<string, unknown[]>).song ?? []) as { id: string }[];
  return songs.map((s) => s.id).sort();
}

async function albumNames(qs: string): Promise<string[]> {
  const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=alphabeticalByName&size=50&${qs}` });
  const albums = ((json(res.body).albumList2 as Record<string, unknown[]>).album ?? []) as { name: string }[];
  return albums.map((a) => a.name);
}

describe('search3 quality filter', () => {
  it('lossless keeps every lossless file, hi-res included', async () => {
    expect(await songIds('quality=lossless')).toEqual([String(hiresId), String(cdId), String(hiresId + 1)].sort());
  });

  it('hires keeps only files above CD quality', async () => {
    expect(await songIds('quality=hires')).toEqual([String(hiresId)]);
  });

  it('never matches lossy files or tracks that were never profiled', async () => {
    const all = await songIds('quality=lossless');
    expect(all).not.toContain(String(mp3Id));
    expect(all).not.toContain(String(ids.trackId));
  });

  it('ignores an unknown value instead of erroring or injecting SQL', async () => {
    const everything = await songIds('');
    expect(await songIds('quality=1%3BDROP%20TABLE%20tracks')).toEqual(everything);
    expect(await songIds('quality=lossy')).toEqual(everything);
  });

  it('combines with the genre filter', async () => {
    getDb().prepare("UPDATE tracks SET genre = 'Jazz' WHERE id = ?").run(cdId);
    expect(await songIds('quality=lossless&genre=Jazz')).toEqual([String(cdId)]);
  });
});

describe('getAlbumList2 quality filter', () => {
  it('lists albums that contain at least one qualifying track', async () => {
    expect(await albumNames('quality=hires')).toEqual(['Hi-Res Album']);
    expect((await albumNames('quality=lossless')).sort()).toEqual(['CD Album', 'Hi-Res Album']);
  });

  it('keeps the full song count of a matching album', async () => {
    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=alphabeticalByName&size=50&quality=hires` });
    const album = ((json(res.body).albumList2 as Record<string, Record<string, unknown>[]>).album)[0];
    expect(album.songCount).toBe(2); // both tracks, not just the hi-res one
  });

  it('works with other list types too', async () => {
    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=newest&size=50&quality=hires` });
    const albums = (json(res.body).albumList2 as Record<string, { name: string }[]>).album;
    expect(albums.map((a) => a.name)).toEqual(['Hi-Res Album']);
  });
});
