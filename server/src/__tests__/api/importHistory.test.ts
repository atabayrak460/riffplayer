import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { seedLibrary, authParams } from '../subsonic/helpers.js';
import { normaliseName, matchKey } from '../../import/normalise.js';
import { parseSpotifyJson } from '../../import/spotify.js';
import { parseAppleMusicCsv, parseCsv } from '../../import/appleMusic.js';

// Loosely typed JSON from the API — the tests assert on the pieces they care about.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const YEAR = 2023;
const ts = (month: number, day = 10) => `${YEAR}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`;
const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function multipart(filename: string, data: Buffer): { body: Buffer; contentType: string } {
  const boundary = '----riffplayerImportBoundary';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  return { body: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}

const spotify = (rows: object[]) => JSON.stringify(rows);
const spotifyRow = (over: Json = {}) => ({
  ts: ts(3),
  ms_played: 200_000,
  master_metadata_track_name: 'Test Track',
  master_metadata_album_artist_name: 'Test Artist',
  master_metadata_album_album_name: 'Test Album',
  ...over,
});

let app: FastifyInstance;
let ids: ReturnType<typeof seedLibrary>;
const auth = authParams();

beforeEach(async () => {
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  ids = seedLibrary(getDb());
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  closeDb();
});

const upload = (name: string, data: Buffer) => {
  const { body, contentType } = multipart(name, data);
  return app.inject({ method: 'POST', url: `/api/v1/import/history/file?${auth}`, headers: { 'content-type': contentType }, payload: body });
};
const wrapped = async (): Promise<Json> => (await app.inject({ url: `/api/v1/recommendations/wrapped?${auth}&year=${YEAR}` })).json();

describe('name normalisation', () => {
  it('ignores case, accents, punctuation, remaster and feat. tags', () => {
    expect(normaliseName('Beyoncé')).toBe('beyonce');
    expect(normaliseName('Song - 2011 Remaster')).toBe('song');
    expect(normaliseName('Song (feat. Someone)')).toBe('song');
    expect(normaliseName('Song (Remastered 2009)')).toBe('song');
    expect(normaliseName('Guns N’ Roses')).toBe('guns n roses');
    expect(normaliseName('Simon & Garfunkel')).toBe('simon and garfunkel');
    expect(matchKey('TEST ARTIST', 'test track!')).toBe(matchKey('Test Artist', 'Test Track'));
  });
});

describe('parsers', () => {
  it('reads Spotify extended history, dropping podcasts and short skips', () => {
    const plays = parseSpotifyJson(spotify([
      spotifyRow(),
      spotifyRow({ ms_played: 5_000 }),
      spotifyRow({ master_metadata_track_name: null }),
    ]))!;
    expect(plays).toHaveLength(1);
    expect(plays[0]).toMatchObject({ artist: 'Test Artist', title: 'Test Track', album: 'Test Album', playedAt: secs(ts(3)) });
  });

  it('reads the legacy Spotify format', () => {
    const plays = parseSpotifyJson(JSON.stringify([{ endTime: '2023-03-10 12:00', artistName: 'A', trackName: 'B', msPlayed: 100000 }]))!;
    expect(plays).toEqual([{ artist: 'A', title: 'B', album: null, playedAt: secs(ts(3)), durationMs: 100000 }]);
  });

  it('rejects JSON that is not a Spotify export', () => {
    expect(parseSpotifyJson('{"a":1}')).toBeNull();
    expect(parseSpotifyJson('[{"foo":1}]')).toBeNull();
    expect(parseSpotifyJson('nope')).toBeNull();
  });

  it('reads quoted CSV fields', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });

  it('reads Apple Music Play Activity and skips short plays', () => {
    const csv = [
      'Song Name,Artist Name,Album Name,Event Start Timestamp,Play Duration Milliseconds,Media Duration In Milliseconds',
      `"Track, One",Artist,Album,${ts(4)},180000,200000`,
      `Skipped,Artist,Album,${ts(4)},4000,200000`,
    ].join('\n');
    const plays = parseAppleMusicCsv(csv)!;
    expect(plays).toHaveLength(1);
    expect(plays[0]).toMatchObject({ title: 'Track, One', artist: 'Artist', album: 'Album', playedAt: secs(ts(4)) });
  });

  it('reads the Apple Music daily tracks file', () => {
    const csv = 'Track Description,Date Played,Play Duration Milliseconds\nSome Artist - Some Song,20230415,120000\n';
    expect(parseAppleMusicCsv(csv)![0]).toMatchObject({ artist: 'Some Artist', title: 'Some Song' });
  });

  it('rejects an unrelated CSV', () => {
    expect(parseAppleMusicCsv('x,y\n1,2\n')).toBeNull();
  });
});

describe('POST /api/v1/import/history/file', () => {
  it('imports a Spotify file, matching library songs and keeping the rest by name', async () => {
    const res = await upload('Streaming_History_Audio_2023.json', Buffer.from(spotify([
      spotifyRow({ master_metadata_track_name: 'test track!' }),
      spotifyRow({ ts: ts(4), master_metadata_track_name: 'Elsewhere', master_metadata_album_artist_name: 'Far Band', master_metadata_album_album_name: 'Far Album' }),
    ])));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ source: 'spotify', found: 2, added: 2, matched: 1, duplicates: 0 });

    const row = getDb().prepare('SELECT track_id FROM external_plays ORDER BY played_at').all() as { track_id: number | null }[];
    expect(row.map((r) => r.track_id)).toEqual([ids.trackId, null]);
  });

  it('importing the same export twice adds nothing', async () => {
    const file = Buffer.from(spotify([spotifyRow(), spotifyRow({ ts: ts(5) })]));
    await upload('a.json', file);
    const again = await upload('a.json', file);
    expect(again.json()).toMatchObject({ added: 0, duplicates: 2 });
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM external_plays').get() as { n: number }).n).toBe(2);
  });

  it('reads a zip with several files, including a zip inside a zip', async () => {
    const inner = zipSync({ 'Spotify/Streaming_History_Audio_1.json': strToU8(spotify([spotifyRow()])), 'Spotify/Streaming_History_Audio_2.json': strToU8(spotify([spotifyRow({ ts: ts(6) })])) });
    const outer = zipSync({ 'wrapper.zip': inner, 'readme.txt': strToU8('hi') });
    const res = await upload('my_spotify_data.zip', Buffer.from(outer));
    expect(res.json()).toMatchObject({ source: 'spotify', files: 2, added: 2 });
  });

  it('imports Apple Music CSV', async () => {
    const csv = `Song Name,Artist Name,Album Name,Event Start Timestamp,Play Duration Milliseconds\nTest Track,Test Artist,Test Album,${ts(7)},200000\n`;
    const res = await upload('Apple Music Play Activity.csv', Buffer.from(csv));
    expect(res.json()).toMatchObject({ source: 'apple_music', added: 1, matched: 1 });
  });

  it("does not count a Last.fm-style repeat of a play already made in RiffPlayer", async () => {
    getDb().prepare('INSERT INTO play_history (user_id, track_id, played_at) VALUES (1, ?, ?)').run(ids.trackId, secs(ts(3)) + 20);
    const res = await upload('a.json', Buffer.from(spotify([spotifyRow()])));
    expect(res.json()).toMatchObject({ added: 0, duplicates: 1 });
  });

  it('refuses a file that is not an export, and a missing file', async () => {
    expect((await upload('notes.txt', Buffer.from('hello'))).statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url: `/api/v1/import/history/file?${auth}` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('requires a login', async () => {
    const { body, contentType } = multipart('a.json', Buffer.from('[]'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/import/history/file', headers: { 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/import/history/lastfm', () => {
  const post = (payload: Json) => app.inject({ method: 'POST', url: `/api/v1/import/history/lastfm?${auth}`, payload });
  const setKey = () => getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_api_key', 'k')").run();

  it('needs the admin to have configured a Last.fm key', async () => {
    expect((await post({ username: 'someone', year: YEAR })).statusCode).toBe(503);
  });

  it('validates the username', async () => {
    setKey();
    expect((await post({ username: '../x', year: YEAR })).statusCode).toBe(400);
  });

  it('pages through scrobbles and imports them', async () => {
    setKey();
    const track = (name: string, uts: number) => ({ name, artist: { '#text': 'Test Artist' }, album: { '#text': 'Test Album' }, date: { uts: String(uts) } });
    const fetchSpy = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get('page');
      const tracks = page === '1'
        ? [{ name: 'Live', artist: { '#text': 'X' }, '@attr': { nowplaying: 'true' } }, track('Test Track', secs(ts(8)))]
        : [track('Other', secs(ts(9)))];
      return { ok: true, json: async () => ({ recenttracks: { track: tracks, '@attr': { totalPages: '2' } } }) };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await post({ username: 'someone', year: YEAR });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ source: 'lastfm', found: 2, added: 2, matched: 1, truncated: false });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // The profile name and key go to Last.fm, nothing else about the user.
    const asked = new URL(fetchSpy.mock.calls[0][0]);
    expect(asked.searchParams.get('user')).toBe('someone');
  });

  it('explains a private profile', async () => {
    setKey();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 17, message: 'x' }) })));
    const res = await post({ username: 'someone', year: YEAR });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/private/i);
  });
});

describe('summary and removal', () => {
  it('lists imports per source and removes them', async () => {
    await upload('a.json', Buffer.from(spotify([spotifyRow(), spotifyRow({ master_metadata_track_name: 'Elsewhere' })])));
    const list = (await app.inject({ url: `/api/v1/import/history?${auth}` })).json();
    expect(list.sources).toEqual([expect.objectContaining({ source: 'spotify', plays: 2, matched: 1 })]);

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/import/history?${auth}&source=bogus` })).statusCode).toBe(400);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/import/history?${auth}&source=spotify` });
    expect(del.json()).toEqual({ removed: 2 });
    expect((await app.inject({ url: `/api/v1/import/history?${auth}` })).json().sources).toEqual([]);
  });
});

describe('Wrapped with imported history', () => {
  it('counts imported plays with library plays, merging matched songs and flagging the rest', async () => {
    getDb().prepare('INSERT INTO play_history (user_id, track_id, played_at) VALUES (1, ?, ?)').run(ids.trackId, secs(ts(1)));
    await upload('a.json', Buffer.from(spotify([
      spotifyRow({ ts: ts(2) }),
      spotifyRow({ ts: ts(2, 11), master_metadata_track_name: 'Elsewhere', master_metadata_album_artist_name: 'Far Band', master_metadata_album_album_name: 'Far Album' }),
      spotifyRow({ ts: ts(3), master_metadata_track_name: 'Elsewhere', master_metadata_album_artist_name: 'Far Band', master_metadata_album_album_name: 'Far Album' }),
    ])));

    const w = await wrapped();
    expect(w.totalPlays).toBe(4);
    expect(w.importedPlays).toBe(3);
    // 200 s imported ×3 → minutes combine library 210 s + imported
    expect(w.totalMinutes).toBe(Math.round((210 + 200 * 3) / 60));

    expect(w.topTracks[0]).toMatchObject({ id: String(ids.trackId), playCount: 2 });
    expect(w.topTracks[0].external).toBeUndefined();
    expect(w.topTracks[1]).toMatchObject({ id: '', title: 'Elsewhere', artist: 'Far Band', playCount: 2, external: true, coverArt: null });
    expect(w.topArtists.map((a: Json) => [a.name, a.playCount])).toEqual([['Test Artist', 2], ['Far Band', 2]]);
    expect(w.topAlbums.find((a: Json) => a.name === 'Far Album')).toMatchObject({ external: true, playCount: 2 });
    expect(w.byMonth).toEqual([{ month: 1, plays: 1 }, { month: 2, plays: 2 }, { month: 3, plays: 1 }]);
  });

  it('ignores other users and other years', async () => {
    await upload('a.json', Buffer.from(spotify([spotifyRow({ ts: '2022-05-05T10:00:00Z' })])));
    expect((await wrapped()).totalPlays).toBe(0);
  });

  it('is unchanged when nothing was imported', async () => {
    getDb().prepare('INSERT INTO play_history (user_id, track_id, played_at) VALUES (1, ?, ?)').run(ids.trackId, secs(ts(1)));
    const w = await wrapped();
    expect(w).toMatchObject({ totalPlays: 1, importedPlays: 0, totalMinutes: 4 });
    expect(w.topAlbums[0]).toMatchObject({ name: 'Test Album', artist: 'Test Artist', coverArt: `al-${ids.albumId}` });
  });
});
