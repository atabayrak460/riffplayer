import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { authParams } from '../subsonic/helpers.js';
import { approvePairing, pollPairing, resetPairingForTests, startPairing, PAIRING_TTL_MS } from '../../auth/devicePairing.js';

let app: FastifyInstance;
const auth = authParams();

beforeEach(async () => {
  resetPairingForTests();
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  closeDb();
});

const post = (url: string, payload: unknown, qs = '') =>
  app.inject({ method: 'POST', url: `/api/v1/${url}${qs ? `?${qs}` : ''}`, payload: payload as object });

describe('device pairing (the domain logic)', () => {
  it('hands out a short readable code and a long secret one', () => {
    const p = startPairing('Living room TV');
    expect(p.userCode).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(p.deviceCode).toMatch(/^[0-9a-f]{48}$/);
    expect(p.expiresIn).toBe(600);
  });

  it('is pending until a user approves, then yields the approval exactly once', () => {
    const p = startPairing('TV');
    expect(pollPairing(p.deviceCode).status).toBe('pending');
    expect(approvePairing(p.userCode, { userId: 7 })).toEqual({ deviceName: 'TV' });

    const done = pollPairing(p.deviceCode);
    expect(done).toMatchObject({ status: 'approved', approval: { userId: 7 } });
    expect(pollPairing(p.deviceCode).status).toBe('expired'); // collected: gone
  });

  it('accepts the code however it is typed (case, dash, spaces)', () => {
    const p = startPairing('TV');
    const raw = p.userCode.replace('-', '').toLowerCase();
    expect(approvePairing(` ${raw.slice(0, 4)} ${raw.slice(4)} `, { userId: 1 })).not.toBeNull();
  });

  it('an unknown code, or one already approved, does not approve', () => {
    const p = startPairing('TV');
    expect(approvePairing('ZZZZ-ZZZZ', { userId: 1 })).toBeNull();
    approvePairing(p.userCode, { userId: 1 });
    expect(approvePairing(p.userCode, { userId: 2 })).toBeNull(); // can't be taken over by a second user
  });

  it('expires after ten minutes', () => {
    const t = 1_000_000;
    const p = startPairing('TV', t);
    expect(pollPairing(p.deviceCode, t + PAIRING_TTL_MS - 1).status).toBe('pending');
    expect(pollPairing(p.deviceCode, t + PAIRING_TTL_MS + 1).status).toBe('expired');
    const q = startPairing('TV', t);
    expect(approvePairing(q.userCode, { userId: 1 }, t + PAIRING_TTL_MS + 1)).toBeNull();
  });

  it('a wrong device code is just "expired" — it reveals nothing', () => {
    startPairing('TV');
    expect(pollPairing('0'.repeat(48)).status).toBe('expired');
  });

  it('never keeps more than a couple hundred pairings in memory', () => {
    const first = startPairing('first');
    for (let i = 0; i < 300; i++) startPairing(`tv ${i}`);
    expect(pollPairing(first.deviceCode).status).toBe('expired'); // the oldest made way
  });
});

describe('the HTTP flow', () => {
  it('lets a TV link itself using only a code approved by a signed-in user', async () => {
    const start = (await post('auth/device-code', { deviceName: '  Living   room TV ' })).json() as { deviceCode: string; userCode: string };

    const early = await post('auth/device-token', { deviceCode: start.deviceCode });
    expect(early.statusCode).toBe(202);
    expect(early.json()).toEqual({ status: 'pending' });

    const approve = await post('auth/device-approve', { userCode: start.userCode }, auth);
    expect(approve.statusCode).toBe(200);
    expect(approve.json()).toEqual({ ok: true, deviceName: 'Living room TV' });

    const done = (await post('auth/device-token', { deviceCode: start.deviceCode })).json() as {
      status: string; token: string; apiKey: string; user: { username: string };
    };
    expect(done.status).toBe('approved');
    expect(done.user.username).toBe('admin');

    // The token works for /api/v1, the API key for the Subsonic API (ping needs no login, so ask for something that does) — and the password was never involved.
    const me = await app.inject({ url: '/api/v1/users/me', headers: { authorization: `Bearer ${done.token}` } });
    expect(me.json()).toMatchObject({ username: 'admin' });
    const ping = await app.inject({ url: `/rest/getGenres.view?u=admin&apiKey=${done.apiKey}&v=1.16.1&c=tv&f=json` });
    expect((JSON.parse(ping.body) as Record<string, { status: string }>)['subsonic-response'].status).toBe('ok');
    expect(JSON.stringify(done)).not.toContain('"password"');

    // A second poll finds nothing: the approval can be collected once.
    expect((await post('auth/device-token', { deviceCode: start.deviceCode })).statusCode).toBe(410);
  });

  it('approving needs a signed-in user and a valid code', async () => {
    const start = (await post('auth/device-code', {})).json() as { userCode: string };
    expect((await post('auth/device-approve', { userCode: start.userCode })).statusCode).toBe(401);
    expect((await post('auth/device-approve', { userCode: 'NOPE-NOPE' }, auth)).statusCode).toBe(404);
    expect((await post('auth/device-approve', {}, auth)).statusCode).toBe(400);
  });

  it('rejects malformed device codes', async () => {
    expect((await post('auth/device-token', {})).statusCode).toBe(400);
    expect((await post('auth/device-token', { deviceCode: 'short' })).statusCode).toBe(400);
  });

  it('defaults a missing or silly device name', async () => {
    const a = (await post('auth/device-code', {})).json() as { userCode: string };
    expect((await post('auth/device-approve', { userCode: a.userCode }, auth)).json()).toEqual({ ok: true, deviceName: 'TV' });
    const b = (await post('auth/device-code', { deviceName: 42 })).json() as { userCode: string };
    expect((await post('auth/device-approve', { userCode: b.userCode }, auth)).json()).toEqual({ ok: true, deviceName: 'TV' });
  });
});

describe('linked devices', () => {
  async function link(name: string): Promise<string> {
    const start = (await post('auth/device-code', { deviceName: name })).json() as { deviceCode: string; userCode: string };
    await post('auth/device-approve', { userCode: start.userCode }, auth);
    return ((await post('auth/device-token', { deviceCode: start.deviceCode })).json() as { apiKey: string }).apiKey;
  }

  it('lists what was linked and lets the user unlink it, which stops its key working', async () => {
    const key = await link('Bedroom TV');
    const list = (await app.inject({ url: `/api/v1/users/me/linked-devices?${auth}` })).json() as { devices: { id: number; name: string }[] };
    expect(list.devices.map((d) => d.name)).toEqual(['Bedroom TV']);

    const ping = () => app.inject({ url: `/rest/getGenres.view?u=admin&apiKey=${key}&v=1.16.1&c=tv&f=json` });
    expect(JSON.parse((await ping()).body)['subsonic-response'].status).toBe('ok');

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/users/me/linked-devices/${list.devices[0].id}?${auth}` });
    expect(del.statusCode).toBe(200);
    expect(JSON.parse((await ping()).body)['subsonic-response'].status).toBe('failed');
  });

  it('only shows and removes linked devices, never other API keys', async () => {
    getDb().prepare("INSERT INTO api_keys (user_id, key_hash, name) VALUES (1, 'abc', 'My script')").run();
    await link('TV');
    const list = (await app.inject({ url: `/api/v1/users/me/linked-devices?${auth}` })).json() as { devices: { name: string }[] };
    expect(list.devices.map((d) => d.name)).toEqual(['TV']);

    const otherId = (getDb().prepare("SELECT id FROM api_keys WHERE name = 'My script'").get() as { id: number }).id;
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/users/me/linked-devices/${otherId}?${auth}` })).statusCode).toBe(404);
  });

  it('404s for an unknown id and needs a login', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/users/me/linked-devices/9999?${auth}` })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/v1/users/me/linked-devices' })).statusCode).toBe(401);
  });
});
