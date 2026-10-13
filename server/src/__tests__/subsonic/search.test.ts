import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { seedLibrary, authParams } from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  seedLibrary(getDb());
});

afterEach(async () => {
  await app.close();
  closeDb();
});

const auth = authParams();
const sr = (body: string) =>
  (JSON.parse(body) as Record<string, Record<string, unknown>>)['subsonic-response'];

describe('search3', () => {
  it('finds artists, albums, and songs in a single query', async () => {
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=Test` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const result = r.searchResult3 as Record<string, unknown[]>;
    expect(result.artist.length).toBe(1);
    expect(result.album.length).toBe(1);
    expect(result.song.length).toBe(1);
  });

  it('returns empty results for no match', async () => {
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=zzznomatch` });
    const r = sr(res.body);
    expect(r.status).toBe('ok');
    const result = r.searchResult3 as Record<string, unknown[]>;
    expect(result.artist.length).toBe(0);
    expect(result.album.length).toBe(0);
    expect(result.song.length).toBe(0);
  });

  it('honours artistCount=0 (returns only albums and songs)', async () => {
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=Test&artistCount=0` });
    const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
    expect(result.artist.length).toBe(0);
    expect(result.album.length).toBe(1);
    expect(result.song.length).toBe(1);
  });

  it('honours artistOffset beyond available results', async () => {
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=Test&artistOffset=100` });
    const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
    expect(result.artist.length).toBe(0);
  });

  it('finds an album when query matches only the album name', async () => {
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=Album&artistCount=0&songCount=0` });
    const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
    expect(result.album.length).toBe(1);
  });

  it('finds a song when query matches only the track title', async () => {
    const res = await app.inject({ url: `/rest/search3.view?${auth}&query=Track&artistCount=0&albumCount=0` });
    const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
    expect(result.song.length).toBe(1);
  });

  it('treats a literal underscore in the query as a literal character, not a wildcard', async () => {
    // "T_" would spuriously match "Test Artist" if `_` were left as an
    // unescaped LIKE wildcard (it matches any single character) — it must not
    // match once `_` is escaped. (A 2-character query takes the LIKE path;
    // longer ones go through FTS and, failing that, the typo-tolerant search,
    // which deliberately looks past punctuation.)
    const res = await app.inject({
      url: `/rest/search3.view?${auth}&query=${encodeURIComponent('T_')}&albumCount=0&songCount=0`,
    });
    const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
    expect(result.artist.length).toBe(0);
  });

  it('treats a literal percent sign in the query as a literal character, not a wildcard', async () => {
    const res = await app.inject({
      url: `/rest/search3.view?${auth}&query=${encodeURIComponent('T%')}&albumCount=0&songCount=0`,
    });
    const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
    expect(result.artist.length).toBe(0);
  });

  // #52: search3 is now backed by trigram FTS5 for queries >= 3 chars.
  describe('FTS5-backed matching (#52)', () => {
    it('matches a substring in the middle of a name, not just a prefix', async () => {
      const res = await app.inject({
        url: `/rest/search3.view?${auth}&query=${encodeURIComponent('est Art')}&albumCount=0&songCount=0`,
      });
      const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
      expect(result.artist.length).toBe(1); // "Test Artist" contains "est Art"
    });

    it('matches case-insensitively', async () => {
      const res = await app.inject({
        url: `/rest/search3.view?${auth}&query=${encodeURIComponent('tEsT aRtIsT')}&albumCount=0&songCount=0`,
      });
      const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
      expect(result.artist.length).toBe(1);
    });

    it('a literal double-quote in the query does not break the FTS phrase or crash the request', async () => {
      const res = await app.inject({
        url: `/rest/search3.view?${auth}&query=${encodeURIComponent('Test "Artist')}`,
      });
      expect(res.statusCode).toBe(200);
      expect(sr(res.body).status).toBe('ok');
    });

    it('still works for a query shorter than the FTS trigram minimum (falls back to LIKE)', async () => {
      const res = await app.inject({
        url: `/rest/search3.view?${auth}&query=Te&albumCount=0&songCount=0`,
      });
      const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
      expect(result.artist.length).toBe(1); // "Test Artist" starts with "Te"
    });

    it('finds a track added after startup, via the sync trigger, not just what existed at migration time', async () => {
      const db = getDb();
      const { id: albumId, artist_id: artistId } = db
        .prepare('SELECT id, artist_id FROM albums LIMIT 1')
        .get() as { id: number; artist_id: number };
      db.prepare(`
        INSERT INTO tracks (title, album_id, artist_id, track_no, duration_s, path, size, format, bitrate)
        VALUES ('Brand New Zzyzx Song', ?, ?, 1, 200, '/music/new.mp3', 1, 'MPEG', 128)
      `).run(albumId, artistId);

      const res = await app.inject({
        url: `/rest/search3.view?${auth}&query=${encodeURIComponent('New Zzyzx')}&artistCount=0&albumCount=0`,
      });
      const result = (sr(res.body).searchResult3) as Record<string, unknown[]>;
      expect(result.song.length).toBe(1);
    });
  });
});

// Typo tolerance: an exact search that finds nothing is retried allowing a typo.
describe('search3 typo tolerance', () => {
  const search = async (query: string, extra = '') => {
    const res = await app.inject({
      url: `/rest/search3.view?${auth}&query=${encodeURIComponent(query)}${extra}`,
    });
    return sr(res.body).searchResult3 as Record<string, Array<Record<string, unknown>>>;
  };

  it('finds an artist despite a wrong letter', async () => {
    const result = await search('Test Artest');
    expect(result.artist.map((a) => a.name)).toEqual(['Test Artist']);
  });

  it('finds an album and a song despite swapped letters', async () => {
    const result = await search('Tset Album');
    expect(result.album.map((a) => a.name)).toEqual(['Test Album']);
    const songs = await search('Test Tarck');
    expect(songs.song.map((s) => s.title)).toEqual(['Test Track']);
  });

  it('finds a name with a missing letter', async () => {
    const result = await search('Tst Artist');
    expect(result.artist).toHaveLength(1);
  });

  it('ignores accents and case', async () => {
    const db = getDb();
    db.prepare('INSERT INTO artists (id, name) VALUES (9001, ?)').run('Beyoncé');
    const result = await search('BEYONSE', '&albumCount=0&songCount=0');
    expect(result.artist.map((a) => a.name)).toEqual(['Beyoncé']);
  });

  it('does not use it when the exact search already found something', async () => {
    const db = getDb();
    db.prepare('INSERT INTO artists (id, name) VALUES (9002, ?)').run('Test Artisan');
    // "Test Artis" matches exactly; "Test Artisan" is not returned as a fuzzy extra of anything.
    const result = await search('Test Artist', '&albumCount=0&songCount=0');
    expect(result.artist.map((a) => a.name)).toEqual(['Test Artist']);
  });

  it('does not match unrelated names', async () => {
    const result = await search('Completely Different');
    expect(result.artist).toHaveLength(0);
    expect(result.album).toHaveLength(0);
    expect(result.song).toHaveLength(0);
  });

  it('tolerates only one slip in a short query', async () => {
    const result = await search('Txsx', '&albumCount=0&songCount=0'); // two wrong letters
    expect(result.artist).toHaveLength(0);
  });

  it('allows a second slip in a long query', async () => {
    const result = await search('Tezt Artizt', '&albumCount=0&songCount=0');
    expect(result.artist.map((a) => a.name)).toEqual(['Test Artist']);
  });

  it('does not start for a query too short to carry a typo', async () => {
    const result = await search('Tas', '&albumCount=0&songCount=0');
    expect(result.artist).toHaveLength(0);
  });

  it('respects the count of each kind', async () => {
    const result = await search('Test Artest', '&artistCount=0');
    expect(result.artist).toHaveLength(0);
  });

  it('keeps the genre filter on songs', async () => {
    const result = await search('Test Tarck', '&genre=Nope&artistCount=0&albumCount=0');
    expect(result.song).toHaveLength(0);
  });

  it('a user-supplied sort=relevance does not break an ordinary search', async () => {
    const res = await app.inject({
      url: `/rest/search3.view?${auth}&query=Test&sort=relevance`,
    });
    expect(res.statusCode).toBe(200);
    expect(sr(res.body).status).toBe('ok');
  });
});
