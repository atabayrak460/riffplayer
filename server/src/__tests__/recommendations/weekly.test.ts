import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { seedLibrary, authParams } from '../subsonic/helpers.js';
import { generateWeek, getWeekly, weekStart } from '../../recommendations/weekly.js';

let app: FastifyInstance;
const auth = authParams();


// What the (mocked) Last.fm says.
const SIMILAR: Record<string, string[]> = {
  'Test Artist': ['Brand New Band', 'Another Act', 'Owned Artist'],
};
const TOP_TRACKS: Record<string, string[]> = {
  'Brand New Band': ['Hit One', 'Hit Two'],
  'Another Act': [],
};
let calls: string[];

function mockLastFm() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = new URL(url);
    const method = u.searchParams.get('method')!;
    const artist = u.searchParams.get('artist')!;
    calls.push(`${method}:${artist}`);
    if (method === 'artist.getSimilar') {
      return Response.json({ similarartists: { artist: (SIMILAR[artist] ?? []).map((name) => ({ name })) } });
    }
    return Response.json({ toptracks: { track: (TOP_TRACKS[artist] ?? []).map((name) => ({ name })) } });
  }));
}

beforeEach(async () => {
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  const ids = seedLibrary(getDb());

  const db = getDb();
  // The library also owns "Owned Artist" — which must never be suggested.
  db.prepare("INSERT INTO artists (name) VALUES ('Owned Artist')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('lastfm_api_key', 'k')").run();
  // The user has listened to Test Artist lately.
  db.prepare('INSERT INTO play_history (user_id, track_id) VALUES (1, ?)').run(ids.trackId);
  mockLastFm();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  closeDb();
});

describe('weekStart', () => {
  it('is the Monday (UTC) of that week', () => {
    expect(weekStart(new Date('2026-10-04T12:00:00Z'))).toBe('2026-09-28'); // a Sunday → the Monday before
    expect(weekStart(new Date('2026-10-05T00:00:00Z'))).toBe('2026-10-05'); // a Monday → itself
    expect(weekStart(new Date('2026-10-07T23:59:59Z'))).toBe('2026-10-05');
  });
});

describe('weekly discovery', () => {
  it('suggests similar artists that are not in the library, with one popular track and why', async () => {
    const state = await generateWeek(1, '2026-10-05', () => 0);
    expect(state.status).toBe('ok');
    if (state.status !== 'ok') return;
    const names = state.items.map((i) => i.artist);
    expect(names).toContain('Brand New Band');
    expect(names).toContain('Another Act');
    expect(names).not.toContain('Owned Artist'); // already in the library
    const hit = state.items.find((i) => i.artist === 'Brand New Band')!;
    expect(['Hit One', 'Hit Two']).toContain(hit.track);
    expect(hit.because).toEqual(['Test Artist']);
    expect(state.items.find((i) => i.artist === 'Another Act')!.track).toBeUndefined(); // no named track: still a suggestion
  });

  it('is names only: nothing but artist, track and why', async () => {
    const state = await generateWeek(1, '2026-10-05');
    if (state.status !== 'ok') throw new Error('expected a list');
    for (const item of state.items) {
      expect(Object.keys(item).sort()).toEqual(expect.arrayContaining(['artist', 'because']));
      expect(Object.keys(item).every((k) => ['artist', 'track', 'because'].includes(k))).toBe(true);
      expect(JSON.stringify(item)).not.toMatch(/https?:|www\./i);
    }
  });

  it('is built once per week, then served from storage', async () => {
    const now = new Date('2026-10-07T10:00:00Z');
    await getWeekly(1, now);
    const firstRound = calls.length;
    expect(firstRound).toBeGreaterThan(0);

    const again = await getWeekly(1, now);
    expect(again.status).toBe('ok');
    expect(calls.length).toBe(firstRound); // no new Last.fm calls
  });

  it('a new week gets a new list, and last week\'s is dropped', async () => {
    await getWeekly(1, new Date('2026-10-07T10:00:00Z'));
    await getWeekly(1, new Date('2026-10-14T10:00:00Z'));
    const weeks = (getDb().prepare('SELECT week FROM weekly_discovery WHERE user_id = 1').all() as { week: string }[]).map((r) => r.week);
    expect(weeks).toEqual(['2026-10-12']);
  });

  it('says so when Last.fm is not configured, or there is no listening to go on', async () => {
    getDb().prepare("DELETE FROM settings WHERE key = 'lastfm_api_key'").run();
    expect((await generateWeek(1, '2026-10-05')).status).toBe('not_configured');

    getDb().prepare("INSERT INTO settings (key, value) VALUES ('lastfm_api_key', 'k')").run();
    getDb().prepare('DELETE FROM play_history').run();
    expect((await generateWeek(1, '2026-10-05')).status).toBe('no_history');
  });

  it('a failing Last.fm lookup does not sink the list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const state = await generateWeek(1, '2026-10-05');
    expect(state.status).toBe('ok');
    if (state.status === 'ok') expect(state.items).toEqual([]);
  });

  it('keeps hostile text out of the list', async () => {
    SIMILAR['Test Artist'] = ['Evil\u0007Band <script>'];
    const state = await generateWeek(1, '2026-10-05');
    SIMILAR['Test Artist'] = ['Brand New Band', 'Another Act', 'Owned Artist'];
    if (state.status !== 'ok') throw new Error('expected a list');
    expect([...state.items[0].artist].some((ch) => ch.charCodeAt(0) < 32)).toBe(false);
  });
});

describe('GET /api/v1/recommendations/weekly', () => {
  it('requires authentication', async () => {
    expect((await app.inject({ url: '/api/v1/recommendations/weekly' })).statusCode).toBe(401);
  });

  it('returns the list, and refresh builds it again', async () => {
    const res = await app.inject({ url: `/api/v1/recommendations/weekly?${auth}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; items: { artist: string }[] };
    expect(body.status).toBe('ok');
    expect(body.items.map((i) => i.artist)).toContain('Brand New Band');

    const before = calls.length;
    const refreshed = await app.inject({ method: 'POST', url: `/api/v1/recommendations/weekly/refresh?${auth}` });
    expect(refreshed.statusCode).toBe(200);
    expect(calls.length).toBeGreaterThan(before);
  });

  it('is off when the admin disabled recommendations', async () => {
    getDb().prepare("INSERT INTO settings (key, value) VALUES ('recommendations_enabled', 'false')").run();
    expect((await app.inject({ url: `/api/v1/recommendations/weekly?${auth}` })).statusCode).toBe(403);
  });

  it('reports that Last.fm is not set up instead of erroring', async () => {
    getDb().prepare("DELETE FROM settings WHERE key = 'lastfm_api_key'").run();
    const res = await app.inject({ url: `/api/v1/recommendations/weekly?${auth}` });
    expect(res.json()).toEqual({ status: 'not_configured' });
  });
});
