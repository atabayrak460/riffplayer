/* eslint-disable @typescript-eslint/no-explicit-any -- these tests read untyped JSON straight off the wire */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { authParams, seedLibrary } from '../subsonic/helpers.js';

// These tests run the real server on a TCP port and consume the SSE stream with fetch(), the
// same way the clients do — inject() can't hold a response open.

let app: FastifyInstance;
let base: string;
let trackIds: number[];
const aborters: AbortController[] = [];

const PC = 'pc-device-0001';
const PHONE = 'phone-device-1';

beforeEach(async () => {
  process.env.RIFFPLAYER_CONNECT_HEARTBEAT_MS = '60000';
  process.env.RIFFPLAYER_CONNECT_POLL_HOLD_MS = '150';
  process.env.RIFFPLAYER_CONNECT_TICK_MS = '40';
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  base = await app.listen({ port: 0, host: '127.0.0.1' });

  const db = getDb();
  const { albumId, artistId, trackId } = seedLibrary(db);
  const second = Number(
    db.prepare(`
      INSERT INTO tracks (title, album_id, artist_id, track_no, duration_s, path, size, format, bitrate)
      VALUES ('Second Track', ?, ?, 2, 180, '/music/b.mp3', 900000, 'MPEG', 320)
    `).run(albumId, artistId).lastInsertRowid,
  );
  trackIds = [trackId, second];
});

afterEach(async () => {
  aborters.splice(0).forEach((a) => a.abort());
  await app.close();
  closeDb();
  delete process.env.RIFFPLAYER_CONNECT_HEARTBEAT_MS;
  delete process.env.RIFFPLAYER_CONNECT_POLL_HOLD_MS;
  delete process.env.RIFFPLAYER_CONNECT_TICK_MS;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function login(username = 'admin', password = 'admin'): Promise<string> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return ((await res.json()) as { token: string }).token;
}

async function createUser(username: string, password: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/users?${authParams()}`,
    payload: { username, password, role: 'user' },
  });
  expect(res.statusCode).toBeLessThan(300);
}

interface SseEvent { id?: number; name: string; data: any }

interface Stream {
  status: number;
  headers: Headers;
  events: SseEvent[];
  pings: number;
  ended: boolean;
  next(name: string, predicate?: (data: any) => boolean): Promise<SseEvent>;
  close(): void;
}

async function openStream(token: string, deviceId: string, extra = ''): Promise<Stream> {
  const ctrl = new AbortController();
  aborters.push(ctrl);
  const res = await fetch(`${base}/api/v1/connect/stream?deviceId=${deviceId}&name=${encodeURIComponent(deviceId)}&type=web${extra}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: ctrl.signal,
  });
  const stream: Stream = {
    status: res.status, headers: res.headers, events: [], pings: 0, ended: false,
    close: () => ctrl.abort(),
    next: (name, predicate = () => true) =>
      vi.waitFor(() => {
        const found = stream.events.find((e) => e.name === name && predicate(e.data));
        if (!found) throw new Error(`no "${name}" event yet (have: ${stream.events.map((e) => e.name).join(', ')})`);
        return found;
      }, { timeout: 3000, interval: 10 }),
  };
  if (res.status !== 200 || !res.body) return stream;

  void (async () => {
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (block.startsWith(':')) { stream.pings++; continue; }
          const lines = block.split('\n');
          const name = lines.find((l) => l.startsWith('event: '))?.slice(7);
          const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
          const id = lines.find((l) => l.startsWith('id: '))?.slice(4);
          if (name && data) stream.events.push({ id: id ? Number(id) : undefined, name, data: JSON.parse(data) });
        }
      }
    } catch {
      // aborted by the test
    }
    stream.ended = true;
  })();
  return stream;
}

async function post(token: string, path: string, body: unknown, method = 'POST') {
  const res = await fetch(`${base}/api/v1/connect${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function get(token: string, path: string) {
  const res = await fetch(`${base}/api/v1/connect${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as any };
}

const playing = (deviceId: string, over: Record<string, unknown> = {}) => ({
  deviceId, queueIds: trackIds.map(String), index: 0, positionMs: 12_000, playing: true,
  repeat: 'off', shuffle: false, ...over,
});

// ── Authentication and validation ────────────────────────────────────────────

describe('authentication and input validation', () => {
  it.each([
    ['GET', '/stream?deviceId=pc-device-0001'],
    ['GET', '/poll?deviceId=pc-device-0001'],
    ['GET', '/state'],
    ['GET', '/queue'],
    ['POST', '/state'],
    ['POST', '/command'],
    ['POST', '/transfer'],
    ['PATCH', '/device'],
  ])('%s %s needs authentication', async (method, path) => {
    const res = await fetch(`${base}/api/v1/connect${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    expect(res.status).toBe(401);
  });

  it('refuses a stream without a valid deviceId', async () => {
    const token = await login();
    for (const id of ['', 'short', 'has spaces here', '../../etc/passwd']) {
      const res = await fetch(`${base}/api/v1/connect/stream?deviceId=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(400);
    }
  });

  it('validates bodies', async () => {
    const token = await login();
    await openStream(token, PC);

    expect((await post(token, '/state', {})).status).toBe(400);
    expect((await post(token, '/state', playing(PC, { index: -1 }))).status).toBe(400);
    expect((await post(token, '/state', playing(PC, { repeat: 'loop' }))).status).toBe(400);
    expect((await post(token, '/command', { deviceId: PC, commandId: 'x', type: 'explode' })).status).toBe(400);
    expect((await post(token, '/command', { deviceId: PC, type: 'next' })).status).toBe(400);
    expect((await post(token, '/transfer', { deviceId: PC })).status).toBe(400);
    expect((await post(token, '/transfer', { deviceId: PC, toDeviceId: PHONE, play: 'yes' })).status).toBe(400);
    expect((await post(token, '/device', { deviceId: PC }, 'PATCH')).status).toBe(400);
  });
});

// ── The stream ───────────────────────────────────────────────────────────────

describe('GET /connect/stream', () => {
  it('opens a server-sent-events stream with anti-buffering headers, then hello and snapshot', async () => {
    const token = await login();
    const s = await openStream(token, PC);

    expect(s.status).toBe(200);
    expect(s.headers.get('content-type')).toContain('text/event-stream');
    expect(s.headers.get('cache-control')).toContain('no-cache');
    expect(s.headers.get('x-accel-buffering')).toBe('no');

    const hello = await s.next('hello');
    expect(hello.data.you).toBe(PC);
    expect(typeof hello.data.serverTimeMs).toBe('number');
    const snapshot = await s.next('snapshot');
    expect(snapshot.data.devices).toEqual([
      { id: PC, name: PC, type: 'web', online: true, unreachable: false, active: false },
    ]);
    expect(snapshot.id).toBe(2);
  });

  it('sends heartbeat comments so proxies keep the connection open', async () => {
    process.env.RIFFPLAYER_CONNECT_HEARTBEAT_MS = '40';
    const token = await login();
    const s = await openStream(token, PC);

    await vi.waitFor(() => expect(s.pings).toBeGreaterThanOrEqual(3), { timeout: 3000, interval: 10 });
  });

  it('closes the stream with a "revoked" event when the password is changed', async () => {
    process.env.RIFFPLAYER_CONNECT_HEARTBEAT_MS = '40';
    const token = await login();
    const s = await openStream(token, PC);
    await s.next('hello');

    const { id } = getDb().prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number };
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${id}?${authParams()}`, payload: { password: 'changed-pw' } });
    expect(res.statusCode).toBe(200);

    await s.next('revoked');
    await vi.waitFor(() => expect(s.ended).toBe(true), { timeout: 3000, interval: 10 });
  });

  it('removes the device when the client disconnects', async () => {
    const token = await login();
    const pc = await openStream(token, PC);
    const phone = await openStream(token, PHONE);
    await phone.next('devices', (d) => d.devices.length === 2).catch(() => undefined);

    pc.close();

    const update = await phone.next('devices', (d) => d.devices.length === 1);
    expect(update.data.devices[0].id).toBe(PHONE);
  });

  it('ends open streams promptly when the server shuts down', async () => {
    const token = await login();
    const s = await openStream(token, PC);
    await s.next('hello');

    const started = Date.now();
    await app.close();

    await vi.waitFor(() => expect(s.ended).toBe(true), { timeout: 3000, interval: 10 });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('caps the number of devices per user, answering a real HTTP 429 (not a stream)', async () => {
    const token = await login();
    for (let i = 0; i < 10; i++) await openStream(token, `device-number-${String(i).padStart(2, '0')}`);

    const extra = await openStream(token, 'device-number-99');

    expect(extra.status).toBe(429);
    expect(extra.headers.get('content-type')).toContain('application/json');
  });
});

// ── Playing, controlling, transferring ───────────────────────────────────────

describe('state, commands and transfer between two devices', () => {
  it('mirrors the active device\'s state, with the song resolved from the library, to the other device', async () => {
    const token = await login();
    const pc = await openStream(token, PC);
    const phone = await openStream(token, PHONE);
    await phone.next('hello');

    const r = await post(token, '/state', playing(PC));
    expect(r).toEqual({ status: 200, body: { accepted: true, takeover: true } });

    const state = (await phone.next('state')).data;
    expect(state).toMatchObject({
      activeDeviceId: PC, playing: true, index: 0, queueLength: 2, positionMs: 12_000,
      durationMs: 210_000, repeat: 'off', shuffle: false,
      song: { id: String(trackIds[0]), title: 'Test Track', artist: 'Test Artist' },
    });
    const devices = (await phone.next('devices', (d) => d.activeDeviceId === PC)).data.devices;
    expect(devices.find((d: any) => d.id === PC).active).toBe(true);
    expect(pc.events.some((e) => e.name === 'state')).toBe(false);
  });

  it('relays volume and queue commands, and refuses malformed or unknown ones', async () => {
    const token = await login();
    const pc = await openStream(token, PC);
    const phone = await openStream(token, PHONE);
    await post(token, '/state', playing(PC));
    await phone.next('state');

    expect((await post(token, '/command', { deviceId: PHONE, commandId: 'vol-1', type: 'volume', volume: 0.4 })).status).toBe(202);
    expect((await pc.next('command', (d) => d.commandId === 'vol-1')).data).toMatchObject({ type: 'volume', volume: 0.4 });

    const add = await post(token, '/command', {
      deviceId: PHONE, commandId: 'add-1', type: 'queue_add', mode: 'next', songIds: [String(trackIds[1]), '999999'],
    });
    expect(add.status).toBe(202);
    expect((await pc.next('command', (d) => d.commandId === 'add-1')).data).toMatchObject({ songs: [{ id: String(trackIds[1]) }], mode: 'next' });

    expect((await post(token, '/command', { deviceId: PHONE, commandId: 'add-2', type: 'queue_add', mode: 'end', songIds: ['999999'] })).status).toBe(400);
    expect((await post(token, '/command', { deviceId: PHONE, commandId: 'vol-2', type: 'volume', volume: 3 })).status).toBe(400);
    expect((await post(token, '/command', { deviceId: PHONE, commandId: 'rm-1', type: 'queue_remove', index: 0 })).status).toBe(400);
  });

  it('GET /queue lists the songs with their real positions', async () => {
    const token = await login();
    await openStream(token, PC);
    await post(token, '/state', playing(PC));
    const res = await fetch(`${base}/api/v1/connect/queue`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as any;
    expect(body.songs).toHaveLength(2);
    expect(body.positions).toEqual([0, 1]);
  });

  it('forwards a command only to the active device', async () => {
    const token = await login();
    const pc = await openStream(token, PC);
    const phone = await openStream(token, PHONE);
    await post(token, '/state', playing(PC));
    await phone.next('state');

    const r = await post(token, '/command', { deviceId: PHONE, commandId: 'cmd-1', type: 'seek', positionMs: 30_000 });

    expect(r.status).toBe(202);
    const cmd = (await pc.next('command', (d) => d.commandId === 'cmd-1')).data;
    expect(cmd).toMatchObject({ type: 'seek', positionMs: 30_000 });
    expect(cmd.expiresAtMs).toBeGreaterThan(Date.now());
    expect(phone.events.some((e) => e.name === 'command')).toBe(false);
  });

  it('answers 409 when nothing is playing', async () => {
    const token = await login();
    await openStream(token, PHONE);
    const r = await post(token, '/command', { deviceId: PHONE, commandId: 'c', type: 'pause' });
    expect(r).toEqual({ status: 409, body: { error: 'no_active_device' } });
  });

  it('rejects state and commands from a device that has no open stream', async () => {
    const token = await login();
    expect(await post(token, '/state', playing('never-connected-1'))).toEqual({ status: 409, body: { error: 'unknown_device' } });
    expect(await post(token, '/command', { deviceId: 'never-connected-1', commandId: 'c', type: 'pause' }))
      .toEqual({ status: 409, body: { error: 'unknown_device' } });
  });

  it('asks for the queue when a device starts playing without sending it', async () => {
    const token = await login();
    await openStream(token, PC);
    const r = await post(token, '/state', { ...playing(PC), queueIds: undefined });
    expect(r).toEqual({ status: 409, body: { error: 'need_queue' } });
  });

  it('a bystander\'s paused report is acknowledged but ignored', async () => {
    const token = await login();
    await openStream(token, PC);
    await openStream(token, PHONE);
    await post(token, '/state', playing(PC));

    const r = await post(token, '/state', playing(PHONE, { playing: false }));

    expect(r).toEqual({ status: 200, body: { accepted: false, reason: 'not_active' } });
    expect((await get(token, '/state')).body.activeDeviceId).toBe(PC);
  });

  it('the full handover: pause the old device, hand over queue and position, new device becomes active', async () => {
    const token = await login();
    const pc = await openStream(token, PC);
    const phone = await openStream(token, PHONE);
    await post(token, '/state', playing(PC, { index: 1, positionMs: 20_000 }));
    await phone.next('state');

    const t = await post(token, '/transfer', { deviceId: PHONE, toDeviceId: PHONE, play: true });
    expect(t).toEqual({ status: 202, body: { status: 'pending' } });
    const pause = await pc.next('command', (d) => d.type === 'pause');
    expect(pause.data.commandId).toMatch(/^transfer-/);

    // the old device answers with its final position
    await post(token, '/state', playing(PC, { queueIds: undefined, index: 1, positionMs: 21_500, playing: false }));

    const load = (await phone.next('load')).data;
    expect(load).toEqual({ queueVersion: 1, index: 1, positionMs: 21_500, play: true, counted: false });
    expect((await get(token, '/state')).body.activeDeviceId).toBe(PHONE);

    const queue = await get(token, '/queue');
    expect(queue.status).toBe(200);
    expect(queue.body.songs.map((s: any) => s.title)).toEqual(['Test Track', 'Second Track']);
    expect(queue.body.index).toBe(1);
  });

  it('completes a transfer by itself when the old device does not answer', async () => {
    const token = await login();
    await openStream(token, PC);
    const phone = await openStream(token, PHONE);
    await post(token, '/state', playing(PC));
    await phone.next('state');

    await post(token, '/transfer', { deviceId: PHONE, toDeviceId: PHONE });

    await phone.next('load');
  }, 15_000);

  it('refuses to transfer to an offline device or when nothing is playing', async () => {
    const token = await login();
    await openStream(token, PC);
    await openStream(token, PHONE);

    expect(await post(token, '/transfer', { deviceId: PC, toDeviceId: PHONE })).toEqual({ status: 409, body: { error: 'nothing_playing' } });
    await post(token, '/state', playing(PC));
    expect(await post(token, '/transfer', { deviceId: PC, toDeviceId: 'offline-device-1' })).toEqual({ status: 404, body: { error: 'target_offline' } });
  });

  it('GET /queue is 404 before anything was played', async () => {
    const token = await login();
    expect((await get(token, '/queue')).status).toBe(404);
  });

  it('GET /queue leaves out songs that no longer exist', async () => {
    const token = await login();
    await openStream(token, PC);
    await post(token, '/state', playing(PC, { queueIds: ['999999', String(trackIds[0]), 'abc', String(trackIds[1])], index: 3 }));

    const q = (await get(token, '/queue')).body;

    expect(q.songs.map((s: any) => s.title)).toEqual(['Test Track', 'Second Track']);
    expect(q.index).toBe(1);
  });

  it('renames a device for everyone', async () => {
    const token = await login();
    await openStream(token, PC);
    const phone = await openStream(token, PHONE);

    expect(await post(token, '/device', { deviceId: PC, name: 'Living room PC' }, 'PATCH')).toEqual({ status: 200, body: { ok: true } });

    const update = await phone.next('devices', (d) => d.devices.some((x: any) => x.name === 'Living room PC'));
    expect(update.data.devices.find((x: any) => x.id === PC).name).toBe('Living room PC');
    expect((await post(token, '/device', { deviceId: 'nobody-device-1', name: 'x' }, 'PATCH')).status).toBe(404);
  });
});

// ── Isolation between users (D2) ─────────────────────────────────────────────

describe('users cannot see or control each other\'s devices', () => {
  it('keeps devices, state and commands inside one account', async () => {
    await createUser('alice', 'alice-pw');
    const adminToken = await login();
    const aliceToken = await login('alice', 'alice-pw');
    const adminPc = await openStream(adminToken, PC);
    const aliceTab = await openStream(aliceToken, 'alice-tab-0001');
    await post(adminToken, '/state', playing(PC));
    await adminPc.next('hello');

    // alice sees only her own device and no playback
    const aliceState = (await get(aliceToken, '/state')).body;
    expect(aliceState.devices.map((d: any) => d.id)).toEqual(['alice-tab-0001']);
    expect(aliceState.state).toBeNull();

    // she can neither command the admin's PC nor use its id
    expect(await post(aliceToken, '/command', { deviceId: 'alice-tab-0001', commandId: 'x', type: 'pause' }))
      .toEqual({ status: 409, body: { error: 'no_active_device' } });
    expect(await post(aliceToken, '/command', { deviceId: PC, commandId: 'y', type: 'pause' }))
      .toEqual({ status: 409, body: { error: 'unknown_device' } });
    expect(await post(aliceToken, '/transfer', { deviceId: 'alice-tab-0001', toDeviceId: PC }))
      .toEqual({ status: 404, body: { error: 'target_offline' } });
    expect((await get(aliceToken, '/queue')).status).toBe(404);

    expect(adminPc.events.some((e) => e.name === 'command')).toBe(false);
    expect(aliceTab.events.some((e) => e.name === 'state')).toBe(false);
  });
});

// ── Long-poll fallback ───────────────────────────────────────────────────────

describe('GET /connect/poll (fallback)', () => {
  const poll = (token: string, query: string) => get(token, `/poll?deviceId=${PHONE}&name=Phone&type=android${query}`);

  it('registers the device and returns hello + snapshot at once', async () => {
    const token = await login();

    const r = await poll(token, '');

    expect(r.status).toBe(200);
    expect(r.body.events.map((e: any) => e.event)).toEqual(['hello', 'snapshot']);
    expect(r.body.events.map((e: any) => e.seq)).toEqual([1, 2]);
    expect((await get(token, '/state')).body.devices[0]).toMatchObject({ id: PHONE, name: 'Phone', type: 'android', online: true });
  });

  it('returns an empty list when nothing happens within the hold time', async () => {
    const token = await login();
    const first = await poll(token, '');

    const r = await poll(token, `&since=${first.body.events.at(-1).seq}`);

    expect(r.body.events).toEqual([]);
  });

  it('delivers a command that arrives while the request is held', async () => {
    process.env.RIFFPLAYER_CONNECT_POLL_HOLD_MS = '2000';
    const token = await login();
    const pc = await openStream(token, PC);
    await pc.next('hello');
    const first = await poll(token, '');
    let since = first.body.events.at(-1).seq;
    // the poller starts playing, which makes it the active device
    expect((await post(token, '/state', playing(PHONE))).body).toEqual({ accepted: true, takeover: true });

    // a real client keeps polling with the last seq it saw
    const found: any[] = [];
    const loop = (async () => {
      for (let i = 0; i < 5 && !found.some((e) => e.event === 'command'); i++) {
        const r = await poll(token, `&since=${since}`);
        for (const e of r.body.events) { found.push(e); since = e.seq; }
      }
    })();
    await vi.waitFor(() => expect(found.length).toBeGreaterThan(0), { timeout: 3000, interval: 10 }); // takeover's `devices`
    await post(token, '/command', { deviceId: PC, commandId: 'from-pc', type: 'next' });
    await loop;

    expect(found.find((e) => e.event === 'command').data).toMatchObject({ commandId: 'from-pc', type: 'next' });
  });

  it('rejects a bad since value', async () => {
    const token = await login();
    expect((await poll(token, '&since=-3')).status).toBe(400);
    expect((await poll(token, '&since=abc')).status).toBe(400);
  });
});

// ── Security review ──────────────────────────────────────────────────────────

describe('security: credentials revoked while streams are open', () => {
  const changeAdminPassword = async (password: string) => {
    const { id } = getDb().prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number };
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${id}?${authParams()}`, payload: { password } });
    expect(res.statusCode).toBe(200);
  };

  it('closes only the stream opened with the old token; a stream opened after the change stays up', async () => {
    process.env.RIFFPLAYER_CONNECT_HEARTBEAT_MS = '40';
    const oldToken = await login();
    const stale = await openStream(oldToken, PC);
    await stale.next('hello');

    await changeAdminPassword('changed-pw');
    const newToken = await login('admin', 'changed-pw');
    const fresh = await openStream(newToken, PHONE);
    await fresh.next('hello');

    await stale.next('revoked');
    await vi.waitFor(() => expect(stale.ended).toBe(true), { timeout: 3000, interval: 10 });
    await new Promise((r) => setTimeout(r, 150)); // several heartbeats later...
    expect(fresh.ended).toBe(false);
    expect(fresh.events.some((e) => e.name === 'revoked')).toBe(false);
    expect((await get(newToken, '/state')).body.devices.map((d: any) => d.id)).toEqual([PHONE]);
  });

  it('the heartbeat check alone also revokes just its own connection, never the user\'s newer streams', async () => {
    process.env.RIFFPLAYER_CONNECT_HEARTBEAT_MS = '600';
    process.env.RIFFPLAYER_CONNECT_REVOKE_CHECK_MS = '1000000000000'; // disable the delivery-time check: heartbeat only
    const oldToken = await login();
    const stale = await openStream(oldToken, PC);
    await stale.next('hello');

    await changeAdminPassword('changed-pw');
    const newToken = await login('admin', 'changed-pw');
    const fresh = await openStream(newToken, PHONE);
    await fresh.next('hello');

    await stale.next('revoked');
    expect(fresh.ended).toBe(false);
    expect((await get(newToken, '/state')).body.devices.map((d: any) => d.id)).toEqual([PHONE]);
    delete process.env.RIFFPLAYER_CONNECT_REVOKE_CHECK_MS;
  });

  it('delivers nothing but "revoked" to a revoked stream, even between heartbeats', async () => {
    process.env.RIFFPLAYER_CONNECT_HEARTBEAT_MS = '60000'; // heartbeat far away: only the delivery check can catch it
    process.env.RIFFPLAYER_CONNECT_REVOKE_CHECK_MS = '0';
    const oldToken = await login();
    const stale = await openStream(oldToken, PC);
    await stale.next('hello');
    const before = stale.events.length;

    await changeAdminPassword('changed-pw');
    const newToken = await login('admin', 'changed-pw');
    await openStream(newToken, 'secret-device-01'); // makes the server tell every device of the user about it

    await stale.next('revoked');
    const after = stale.events.slice(before);
    expect(after.map((e) => e.name)).toEqual(['revoked']);
    expect(JSON.stringify(after)).not.toContain('secret-device-01');
    delete process.env.RIFFPLAYER_CONNECT_REVOKE_CHECK_MS;
  });

  it('a revoked token can no longer poll, command, report or transfer', async () => {
    const oldToken = await login();
    await openStream(oldToken, PC);
    await changeAdminPassword('changed-pw');

    for (const [method, path, body] of [
      ['GET', '/poll?deviceId=pc-device-0001', undefined],
      ['GET', '/state', undefined],
      ['GET', '/queue', undefined],
      ['POST', '/state', playing(PC)],
      ['POST', '/command', { deviceId: PC, commandId: 'c', type: 'next' }],
      ['POST', '/transfer', { deviceId: PC, toDeviceId: PHONE }],
      ['PATCH', '/device', { deviceId: PC, name: 'x' }],
    ] as const) {
      const res = await fetch(`${base}/api/v1/connect${path}`, {
        method,
        headers: { authorization: `Bearer ${oldToken}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe('security: authentication cannot be skipped', () => {
  it('a stream request with wrong Subsonic credentials and no token is not a stream and registers nothing', async () => {
    const token = await login();
    const res = await fetch(`${base}/api/v1/connect/stream?deviceId=attacker-device-1&u=admin&t=00000000000000000000000000000000&s=abc&v=1.16.1&c=x&f=json`);

    expect(res.headers.get('content-type') ?? '').not.toContain('text/event-stream');
    res.body?.cancel().catch(() => undefined);
    expect((await get(token, '/state')).body.devices).toEqual([]);
  });

  it('a garbage or forged bearer token is refused', async () => {
    for (const token of ['garbage', 'a.b.c', '']) {
      const res = await fetch(`${base}/api/v1/connect/stream?deviceId=attacker-device-1`, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(401);
    }
  });

  it('a token for a user that no longer exists is refused', async () => {
    await createUser('mallory', 'mallory-pw');
    const token = await login('mallory', 'mallory-pw');
    getDb().prepare("DELETE FROM users WHERE username = 'mallory'").run();

    const res = await fetch(`${base}/api/v1/connect/stream?deviceId=attacker-device-1`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });
});

describe('security: a command goes to the device the sender saw playing', () => {
  it('is refused with 409 target_changed when another device took over in the meantime', async () => {
    const token = await login();
    const pc = await openStream(token, PC);
    const phone = await openStream(token, PHONE);
    const tablet = await openStream(token, 'tablet-device-01');
    await post(token, '/state', playing(PC));
    await post(token, '/state', playing(PHONE, { queueIds: [String(trackIds[1])] })); // phone took over
    await phone.next('state');
    await pc.next('command', (d) => d.type === 'pause'); // the takeover's own "pause" for the PC
    await new Promise((r) => setTimeout(r, 50));
    pc.events.length = 0;
    phone.events.length = 0;

    const stale = await post(token, '/command', { deviceId: 'tablet-device-01', commandId: 'c1', type: 'next', targetDeviceId: PC });

    expect(stale).toEqual({ status: 409, body: { error: 'target_changed' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(phone.events.some((e) => e.name === 'command')).toBe(false);
    expect(pc.events.some((e) => e.name === 'command')).toBe(false);

    const fresh = await post(token, '/command', { deviceId: 'tablet-device-01', commandId: 'c2', type: 'next', targetDeviceId: PHONE });
    expect(fresh.status).toBe(202);
    await phone.next('command', (d) => d.commandId === 'c2');
    void tablet;
  });

  it('rejects a malformed targetDeviceId', async () => {
    const token = await login();
    await openStream(token, PC);
    const r = await post(token, '/command', { deviceId: PC, commandId: 'c1', type: 'next', targetDeviceId: '../../x' });
    expect(r.status).toBe(400);
  });
});

describe('security: abuse limits', () => {
  it('refuses oversized bodies on the small endpoints, and on /state beyond its own limit', async () => {
    const token = await login();
    await openStream(token, PC);
    const big = 'x'.repeat(20 * 1024);

    expect((await post(token, '/command', { deviceId: PC, commandId: 'c', type: 'next', pad: big })).status).toBe(413);
    expect((await post(token, '/transfer', { deviceId: PC, toDeviceId: PHONE, pad: big })).status).toBe(413);
    expect((await post(token, '/device', { deviceId: PC, name: 'x', pad: big }, 'PATCH')).status).toBe(413);
    expect((await post(token, '/state', { ...playing(PC), pad: 'x'.repeat(300 * 1024) })).status).toBe(413);
  });

  it('rate limits the full-queue read (it resolves up to 5000 songs per call)', async () => {
    const token = await login();
    await openStream(token, PC);
    await post(token, '/state', playing(PC));

    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await get(token, '/queue')).status);

    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(429);
  });

  it('rate limits renaming (every rename is broadcast to every device)', async () => {
    const token = await login();
    await openStream(token, PC);

    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await post(token, '/device', { deviceId: PC, name: `n${i}` }, 'PATCH')).status);

    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(429);
  });

  it('rate limits reconnecting, so a reconnect loop cannot flood the user\'s other devices', async () => {
    const token = await login();
    await openStream(token, PC);
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await openStream(token, PHONE)).status);

    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(429);
  });

  it('a stream with a hostile device name cannot inject markup or extra SSE fields', async () => {
    const token = await login();
    const viewer = await openStream(token, PC);
    await viewer.next('hello');

    await openStream(token, PHONE, `&name=${encodeURIComponent('Evil\nevent: command\ndata: {"type":"next"}\n\n‮gnp')}`);

    const update = await viewer.next('devices', (d) => d.devices.length === 2);
    const evil = update.data.devices.find((d: any) => d.id === PHONE);
    expect(evil.name).not.toMatch(/[\n\r‮]/);
    expect(viewer.events.some((e) => e.name === 'command')).toBe(false);
  });
});
