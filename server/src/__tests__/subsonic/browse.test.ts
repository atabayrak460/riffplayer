import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { seedLibrary, authParams } from './helpers.js';

let app: FastifyInstance;
let ids: ReturnType<typeof seedLibrary>;

beforeEach(async () => {
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  ids = seedLibrary(getDb());
});

afterEach(async () => {
  await app.close();
  closeDb();
});

const auth = authParams();

function sr(body: string) {
  return (JSON.parse(body) as Record<string, Record<string, unknown>>)['subsonic-response'];
}

describe('getLicense', () => {
  it('returns a valid license', async () => {
    const res = await app.inject({ url: `/rest/getLicense.view?${auth}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    expect((r.license as Record<string, unknown>).valid).toBe(true);
  });
});

describe('getOpenSubsonicExtensions', () => {
  it('advertises apiKeyAuthentication and songLyrics', async () => {
    const res = await app.inject({ url: `/rest/getOpenSubsonicExtensions.view?${auth}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const extensions = r.openSubsonicExtensions as { name: string; versions: number[] }[];
    expect(extensions).toEqual(
      expect.arrayContaining([
        { name: 'apiKeyAuthentication', versions: [1] },
        { name: 'songLyrics', versions: [1] },
      ]),
    );
  });
});

describe('getMusicFolders', () => {
  it('lists configured folders', async () => {
    const res = await app.inject({ url: `/rest/getMusicFolders.view?${auth}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const folders = (r.musicFolders as Record<string, unknown[]>).musicFolder;
    expect(folders.length).toBeGreaterThan(0);
  });
});

describe('getArtists', () => {
  it('returns indexed artists', async () => {
    const res = await app.inject({ url: `/rest/getArtists.view?${auth}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const artists = (r.artists as Record<string, unknown>);
    expect(artists).toBeDefined();
  });
});

describe('getIndexes', () => {
  it('returns artist indexes', async () => {
    const res = await app.inject({ url: `/rest/getIndexes.view?${auth}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const indexes = (r.indexes as Record<string, unknown>);
    expect(indexes).toBeDefined();
  });
});

describe('getArtist', () => {
  it('returns an artist with albums', async () => {
    const res = await app.inject({ url: `/rest/getArtist.view?${auth}&id=${ids.artistId}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const artist = r.artist as Record<string, unknown>;
    expect(artist.name).toBe('Test Artist');
    expect((artist.album as unknown[]).length).toBe(1);
  });

  it('returns error for unknown artist', async () => {
    const res = await app.inject({ url: `/rest/getArtist.view?${auth}&id=99999` });
    const r = sr(res.body);
    expect(r.status).toBe('failed');
    expect((r.error as Record<string, unknown>).code).toBe(70);
  });
});

describe('getAlbum', () => {
  it('returns an album with songs', async () => {
    const res = await app.inject({ url: `/rest/getAlbum.view?${auth}&id=${ids.albumId}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const album = r.album as Record<string, unknown>;
    expect(album.name).toBe('Test Album');
    expect((album.song as unknown[]).length).toBe(1);
  });

  it('returns MISSING_PARAM when id is absent', async () => {
    const res = await app.inject({ url: `/rest/getAlbum.view?${auth}` });
    const r = sr(res.body);
    expect(r.status).toBe('failed');
    expect((r.error as Record<string, unknown>).code).toBe(10);
  });

  it('returns DATA_NOT_FOUND for unknown album', async () => {
    const res = await app.inject({ url: `/rest/getAlbum.view?${auth}&id=99999` });
    const r = sr(res.body);
    expect(r.status).toBe('failed');
    expect((r.error as Record<string, unknown>).code).toBe(70);
  });
});

describe('getSong', () => {
  it('returns a song with correct fields', async () => {
    const res = await app.inject({ url: `/rest/getSong.view?${auth}&id=${ids.trackId}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const song = r.song as Record<string, unknown>;
    expect(song.title).toBe('Test Track');
    expect(song.type).toBe('music');
    expect(song.isVideo).toBe(false);
    expect(song.suffix).toBe('mp3');
  });

  it('returns MISSING_PARAM when id is absent', async () => {
    const res = await app.inject({ url: `/rest/getSong.view?${auth}` });
    const r = sr(res.body);
    expect(r.status).toBe('failed');
    expect((r.error as Record<string, unknown>).code).toBe(10);
  });

  it('returns DATA_NOT_FOUND for unknown song', async () => {
    const res = await app.inject({ url: `/rest/getSong.view?${auth}&id=99999` });
    const r = sr(res.body);
    expect(r.status).toBe('failed');
    expect((r.error as Record<string, unknown>).code).toBe(70);
  });
});

describe('getAlbumList2', () => {
  it('returns albums (newest)', async () => {
    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=newest` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const list = (r.albumList2 as Record<string, unknown[]>).album;
    expect(list.length).toBe(1);
  });

  it('returns albums (random)', async () => {
    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=random` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
  });

  it('returns albums within the given fromYear/toYear range (byYear)', async () => {
    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=byYear&fromYear=2020&toYear=2025` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const list = (r.albumList2 as Record<string, unknown[]>).album;
    expect(list.length).toBe(1); // seedLibrary's album is year 2024
  });

  it('excludes albums outside the given fromYear/toYear range (byYear)', async () => {
    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=byYear&fromYear=1990&toYear=1999` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const list = (r.albumList2 as Record<string, unknown[]>).album;
    expect(list.length).toBe(0);
  });

  it('handles a reversed fromYear/toYear range without error (byYear)', async () => {
    const res = await app.inject({ url: `/rest/getAlbumList2.view?${auth}&type=byYear&fromYear=2025&toYear=2020` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const list = (r.albumList2 as Record<string, unknown[]>).album;
    expect(list.length).toBe(1);
  });
});

describe('getRandomSongs', () => {
  it('returns songs', async () => {
    const res = await app.inject({ url: `/rest/getRandomSongs.view?${auth}&size=5` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const list = (r.randomSongs as Record<string, unknown[]>).song;
    expect(list.length).toBe(1); // seedLibrary only has one track
  });

  it('respects a fromYear/toYear filter', async () => {
    const res = await app.inject({ url: `/rest/getRandomSongs.view?${auth}&fromYear=1990&toYear=1999` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const list = (r.randomSongs as Record<string, unknown[]>).song;
    expect(list.length).toBe(0); // seedLibrary's album is year 2024, outside the range
  });
});

describe('getTopSongs', () => {
  it('returns MISSING_PARAM when artist is absent', async () => {
    const res = await app.inject({ url: `/rest/getTopSongs.view?${auth}` });
    const r = sr(res.body);
    expect(r.status).toBe('failed');
    expect((r.error as Record<string, unknown>).code).toBe(10);
  });

  it("returns the artist's songs ordered by local play count", async () => {
    const res = await app.inject({ url: `/rest/getTopSongs.view?${auth}&artist=Test Artist` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const list = (r.topSongs as Record<string, unknown[]>).song as Record<string, unknown>[];
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('Test Track');
  });

  it('returns no songs for an unknown artist name', async () => {
    const res = await app.inject({ url: `/rest/getTopSongs.view?${auth}&artist=Nobody` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const list = (r.topSongs as Record<string, unknown[]>).song;
    expect(list.length).toBe(0);
  });
});

// getSimilarSongs / getSimilarSongs2 now run the song radio — see __tests__/api/radio.test.ts.

describe('getMusicDirectory', () => {
  it('browses an artist directory, returning its album as the child', async () => {
    const res = await app.inject({ url: `/rest/getMusicDirectory.view?${auth}&id=${ids.artistId}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const dir = r.directory as Record<string, unknown>;
    const children = dir.child as Record<string, unknown>[];
    expect(children.length).toBe(1);
    // Assert identity, not just count — with a fixture where artist/album ids
    // collided, a count-only assertion passed regardless of which branch
    // (artist-with-albums vs album-with-songs) actually ran.
    expect(children[0].id).toBe(String(ids.albumId));
    expect(children[0].isDir).toBe(true);
    expect(children[0].name).toBe('Test Album');
  });

  it('browses an album directory, returning its track as the child', async () => {
    const res = await app.inject({ url: `/rest/getMusicDirectory.view?${auth}&id=${ids.albumId}` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const dir = r.directory as Record<string, unknown>;
    const children = dir.child as Record<string, unknown>[];
    expect(children.length).toBe(1);
    expect(children[0].id).toBe(String(ids.trackId));
    expect(children[0].isDir).toBe(false);
    expect(children[0].title).toBe('Test Track');
  });

  it('returns DATA_NOT_FOUND for unknown directory id', async () => {
    const res = await app.inject({ url: `/rest/getMusicDirectory.view?${auth}&id=99999` });
    const r = sr(res.body);
    expect(r.status).toBe('failed');
    expect((r.error as Record<string, unknown>).code).toBe(70);
  });
});
