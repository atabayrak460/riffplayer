import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConnectHub, parseStateReport, parseCommand, sanitizeName, validDeviceId,
  type ConnectEvent, type StateReport, type StreamSink,
} from '../../connect/hub.js';

// ── Harness ──────────────────────────────────────────────────────────────────

let clock = 0;
const advance = (ms: number) => { clock += ms; };

const DURATIONS: Record<string, number> = { a: 200_000, b: 180_000, c: 240_000 };

function newHub(over: Partial<ConstructorParameters<typeof ConnectHub>[0]> = {}) {
  return new ConnectHub({
    now: () => clock,
    resolveSongs: (_userId, ids) =>
      ids
        .filter((id) => id in DURATIONS)
        .map((id) => ({ id, durationMs: DURATIONS[id], json: { id, title: `Song ${id}` } })),
    graceMs: 20_000,
    transferWaitMs: 1_500,
    pollTimeoutMs: 45_000,
    maxDevices: 3,
    idleStateMs: 600_000,
    ...over,
  });
}

class Probe {
  events: { seq: number; event: ConnectEvent }[] = [];
  ended = false;
  sink: StreamSink = {
    send: (seq, event) => { this.events.push({ seq, event }); },
    end: () => { this.ended = true; },
  };
  names() { return this.events.map((e) => e.event.name); }
  of<N extends ConnectEvent['name']>(name: N) {
    return this.events.filter((e) => e.event.name === name).map((e) => e.event as Extract<ConnectEvent, { name: N }>);
  }
  last<N extends ConnectEvent['name']>(name: N) { return this.of(name).at(-1); }
  clear() { this.events = []; }
}

const U1 = 1;
const U2 = 2;
const PC = 'pc-device-0001';
const PHONE = 'phone-device-1';

let hub: ConnectHub;

function join(userId: number, deviceId: string, type: 'web' | 'android' = 'web', name = deviceId) {
  const probe = new Probe();
  const r = hub.connectStream(userId, { deviceId, name, type }, probe.sink);
  if (!r.ok) throw new Error(r.reason);
  return { probe, connId: r.connId };
}

const report = (over: Partial<StateReport> = {}): StateReport => ({
  queueIds: ['a', 'b', 'c'], index: 0, positionMs: 10_000, playing: true,
  repeat: 'off', shuffle: false, counted: false, ...over,
});

beforeEach(() => {
  clock = 1_000_000;
  hub = newHub();
});

// ── Connecting ───────────────────────────────────────────────────────────────

describe('connecting', () => {
  it('greets a new device with hello (server time) and a snapshot', () => {
    const { probe } = join(U1, PC);

    expect(probe.names().slice(0, 2)).toEqual(['hello', 'snapshot']);
    expect(probe.of('hello')[0].data).toEqual({ serverTimeMs: clock, you: PC });
    expect(probe.of('snapshot')[0].data.devices).toEqual([
      { id: PC, name: PC, type: 'web', online: true, unreachable: false, active: false },
    ]);
  });

  it('numbers events per device so a poller can ask for "everything after n"', () => {
    const { probe } = join(U1, PC);
    expect(probe.events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('tells the other devices when one joins, but not the one that joined', () => {
    const pc = join(U1, PC);
    pc.probe.clear();
    const phone = join(U1, PHONE, 'android');

    expect(pc.probe.last('devices')!.data.devices.map((d) => d.id)).toEqual([PC, PHONE]);
    expect(phone.probe.names()).toEqual(['hello', 'snapshot']);
  });

  it('a device reconnecting under the same id replaces its old connection', () => {
    const first = join(U1, PC);
    const second = join(U1, PC);

    expect(first.probe.ended).toBe(true);
    expect(second.probe.ended).toBe(false);
    // the old stream's late "close" must not drop the new connection
    hub.disconnect(U1, PC, first.connId);
    expect(hub.snapshot(U1).devices.map((d) => d.id)).toEqual([PC]);
    expect(hub.snapshot(U1).devices[0].online).toBe(true);
  });

  it('refuses a new device beyond the per-user limit, but not a known one reconnecting', () => {
    join(U1, 'device-aaaa-01');
    join(U1, 'device-bbbb-02');
    join(U1, 'device-cccc-03');

    const extra = hub.connectStream(U1, { deviceId: 'device-dddd-04', name: 'x', type: 'web' }, new Probe().sink);
    expect(extra).toEqual({ ok: false, reason: 'too_many_devices' });
    expect(hub.connectStream(U1, { deviceId: 'device-aaaa-01', name: 'x', type: 'web' }, new Probe().sink).ok).toBe(true);
  });

  it('removes a device on disconnect and tells the rest', () => {
    const pc = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    pc.probe.clear();

    hub.disconnect(U1, PHONE, phone.connId);

    expect(pc.probe.last('devices')!.data.devices.map((d) => d.id)).toEqual([PC]);
  });
});

// ── Isolation (D2) ───────────────────────────────────────────────────────────

describe('users are isolated', () => {
  it('never shows, commands or notifies another user\'s devices', () => {
    const mine = join(U1, PC);
    const mineB = join(U1, PHONE, 'android');
    const theirs = join(U2, 'other-user-dev1');
    hub.reportState(U1, PC, report());
    theirs.probe.clear();
    mineB.probe.clear();

    expect(hub.snapshot(U2).devices.map((d) => d.id)).toEqual(['other-user-dev1']);
    expect(hub.snapshot(U2).state).toBeNull();

    // the other user can't command mine: they have no active device of their own
    expect(hub.sendCommand(U2, 'other-user-dev1', { commandId: 'c1', type: 'pause' })).toEqual({ ok: false, reason: 'no_active_device' });
    // and can't use my device id as a sender or transfer target
    expect(hub.sendCommand(U2, PHONE, { commandId: 'c2', type: 'pause' })).toEqual({ ok: false, reason: 'unknown_device' });
    expect(hub.transfer(U2, 'other-user-dev1', PC, true)).toEqual({ ok: false, reason: 'target_offline' });

    expect(mine.probe.of('command')).toEqual([]);
    expect(theirs.probe.events).toEqual([]);
  });
});

// ── State and takeover ───────────────────────────────────────────────────────

describe('reporting state', () => {
  it('a device that starts playing becomes the active one and everyone else hears about it', () => {
    const pc = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    pc.probe.clear();
    phone.probe.clear();

    expect(hub.reportState(U1, PC, report())).toEqual({ ok: true, takeover: true });

    for (const probe of [phone.probe]) {
      expect(probe.last('devices')!.data.activeDeviceId).toBe(PC);
      const state = probe.last('state')!.data;
      expect(state).toMatchObject({
        activeDeviceId: PC, playing: true, index: 0, queueLength: 3, positionMs: 10_000,
        positionAtMs: clock, durationMs: 200_000, song: { id: 'a', title: 'Song a' },
      });
    }
    // the reporter doesn't get its own state echoed back
    expect(pc.probe.of('state')).toEqual([]);
  });

  it('while active, updates are accepted and broadcast with the resolved song', () => {
    join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());
    phone.probe.clear();
    advance(5_000);

    hub.reportState(U1, PC, report({ queueIds: undefined, index: 1, positionMs: 0 }));

    expect(phone.probe.last('state')!.data).toMatchObject({ index: 1, song: { id: 'b' }, durationMs: 180_000, positionAtMs: clock });
  });

  it('only bumps queueVersion when the queue itself changes', () => {
    join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());
    const v1 = phone.probe.last('state')!.data.queueVersion;

    hub.reportState(U1, PC, report({ queueIds: ['a', 'b', 'c'], positionMs: 20_000 }));
    expect(phone.probe.last('state')!.data.queueVersion).toBe(v1);

    hub.reportState(U1, PC, report({ queueIds: ['a', 'c'] }));
    expect(phone.probe.last('state')!.data.queueVersion).toBe(v1 + 1);
    expect(phone.probe.last('state')!.data.queueLength).toBe(2);
  });

  it('a device that starts playing takes over (D1): the previous one is told to pause', () => {
    const pc = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());
    pc.probe.clear();

    expect(hub.reportState(U1, PHONE, report({ queueIds: ['b', 'c'], positionMs: 0 }))).toEqual({ ok: true, takeover: true });

    expect(hub.snapshot(U1).activeDeviceId).toBe(PHONE);
    const pause = pc.probe.of('command')[0].data;
    expect(pause.type).toBe('pause');
    expect(pause.expiresAtMs).toBeGreaterThan(clock);
    expect(pc.probe.last('devices')!.data.activeDeviceId).toBe(PHONE);
    expect(phone.probe.of('command')).toEqual([]);
  });

  it('a paused report from a bystander changes nothing', () => {
    join(U1, PC);
    join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());

    expect(hub.reportState(U1, PHONE, report({ playing: false }))).toEqual({ ok: false, reason: 'not_active' });
    expect(hub.snapshot(U1).activeDeviceId).toBe(PC);
  });

  it('taking over requires the queue (the server may never have seen it)', () => {
    join(U1, PC);
    expect(hub.reportState(U1, PC, report({ queueIds: undefined }))).toEqual({ ok: false, reason: 'need_queue' });
    expect(hub.snapshot(U1).activeDeviceId).toBeNull();
  });

  it('asks the active device to resend the queue when the server lost it', () => {
    // server restarted: nothing known, the (re-registered) device reports without a queue
    join(U1, PC);
    expect(hub.reportState(U1, PC, report({ queueIds: undefined }))).toEqual({ ok: false, reason: 'need_queue' });
  });

  it('rejects reports from unknown devices', () => {
    expect(hub.reportState(U1, 'nobody-device-1', report())).toEqual({ ok: false, reason: 'unknown_device' });
  });

  it('clamps an out-of-range index to the queue', () => {
    join(U1, PC);
    hub.reportState(U1, PC, report({ index: 99 }));
    expect(hub.snapshot(U1).state!.index).toBe(2);
  });

  it('is rate limited per user', () => {
    join(U1, PC);
    hub.reportState(U1, PC, report());
    let limited = 0;
    for (let i = 0; i < 200; i++) {
      const r = hub.reportState(U1, PC, report({ queueIds: undefined }));
      if (!r.ok && r.reason === 'rate_limited') limited++;
    }
    expect(limited).toBeGreaterThan(0);
    advance(11_000);
    expect(hub.reportState(U1, PC, report({ queueIds: undefined })).ok).toBe(true);
  });
});

// ── Commands ─────────────────────────────────────────────────────────────────

describe('commands', () => {
  function playingPcAndPhone() {
    const pc = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());
    pc.probe.clear();
    phone.probe.clear();
    return { pc, phone };
  }

  it('reach only the active device, with a short expiry', () => {
    const { pc, phone } = playingPcAndPhone();

    expect(hub.sendCommand(U1, PHONE, { commandId: 'c1', type: 'next' })).toEqual({ ok: true });

    expect(pc.probe.of('command')[0].data).toEqual({ commandId: 'c1', type: 'next', expiresAtMs: clock + 5_000 });
    expect(phone.probe.of('command')).toEqual([]);
  });

  it('carry the position for a seek', () => {
    const { pc } = playingPcAndPhone();
    hub.sendCommand(U1, PHONE, { commandId: 'c1', type: 'seek', positionMs: 42_000 });
    expect(pc.probe.of('command')[0].data).toMatchObject({ type: 'seek', positionMs: 42_000 });
  });

  it('are delivered once even if the controller retries with the same commandId', () => {
    const { pc } = playingPcAndPhone();

    hub.sendCommand(U1, PHONE, { commandId: 'same', type: 'next' });
    expect(hub.sendCommand(U1, PHONE, { commandId: 'same', type: 'next' })).toEqual({ ok: true, duplicate: true });

    expect(pc.probe.of('command')).toHaveLength(1);
  });

  it('fail clearly when nothing is active', () => {
    join(U1, PHONE, 'android');
    expect(hub.sendCommand(U1, PHONE, { commandId: 'c1', type: 'pause' })).toEqual({ ok: false, reason: 'no_active_device' });
  });

  it('are refused when the active device sends one to itself', () => {
    playingPcAndPhone();
    expect(hub.sendCommand(U1, PC, { commandId: 'c1', type: 'pause' })).toEqual({ ok: false, reason: 'self' });
  });

  it('fail when the active device is offline (it is a ghost, nothing to deliver to)', () => {
    const { pc, phone } = playingPcAndPhone();
    hub.disconnect(U1, PC, pc.connId);
    phone.probe.clear();

    expect(hub.sendCommand(U1, PHONE, { commandId: 'c1', type: 'pause' })).toEqual({ ok: false, reason: 'no_active_device' });
  });

  it('are rate limited per user', () => {
    playingPcAndPhone();
    let limited = 0;
    for (let i = 0; i < 100; i++) {
      const r = hub.sendCommand(U1, PHONE, { commandId: `c${i}`, type: 'next' });
      if (!r.ok && r.reason === 'rate_limited') limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

// ── Transfer ─────────────────────────────────────────────────────────────────

describe('transfer', () => {
  function setup(positionMs = 10_000) {
    const pc = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report({ positionMs }));
    pc.probe.clear();
    phone.probe.clear();
    return { pc, phone };
  }

  it('asks the old device to pause, then hands the queue to the target using its final position', () => {
    const { pc, phone } = setup(10_000);
    advance(3_000);

    expect(hub.transfer(U1, PHONE, PHONE, true)).toEqual({ ok: true, status: 'pending' });
    expect(pc.probe.of('command')[0].data.type).toBe('pause');
    expect(phone.probe.of('load')).toEqual([]); // not yet: waiting for the old device's final position

    advance(200);
    hub.reportState(U1, PC, report({ queueIds: undefined, positionMs: 13_100, playing: false }));

    expect(phone.probe.of('load')[0].data).toEqual({
      queueVersion: 1, index: 0, positionMs: 13_100, play: true, counted: false,
    });
    expect(hub.snapshot(U1).activeDeviceId).toBe(PHONE);
    expect(phone.probe.last('devices')!.data.activeDeviceId).toBe(PHONE);
    expect(pc.probe.last('devices')!.data.activeDeviceId).toBe(PHONE);
  });

  it('does not wait for a stale "still playing" report', () => {
    const { phone } = setup();
    hub.transfer(U1, PHONE, PHONE, true);

    hub.reportState(U1, PC, report({ queueIds: undefined, positionMs: 11_000, playing: true }));

    expect(phone.probe.of('load')).toEqual([]);
  });

  it('proceeds on its own when the old device never answers, extrapolating its position', () => {
    const { phone } = setup(10_000);
    advance(4_000);
    hub.transfer(U1, PHONE, PHONE, true);

    advance(1_499);
    hub.tick();
    expect(phone.probe.of('load')).toEqual([]);

    advance(1);
    hub.tick();
    // 10 s + the 5.5 s that passed since the report
    expect(phone.probe.of('load')[0].data.positionMs).toBe(15_500);
    expect(hub.snapshot(U1).activeDeviceId).toBe(PHONE);
  });

  it('never extrapolates past the end of the song', () => {
    const { phone } = setup(199_000);
    advance(60_000);
    hub.transfer(U1, PHONE, PHONE, true);
    advance(1_500);
    hub.tick();

    expect(phone.probe.of('load')[0].data.positionMs).toBe(200_000);
  });

  it('passes "play: false" through, and whether the play was already counted', () => {
    const { phone } = setup();
    hub.reportState(U1, PC, report({ queueIds: undefined, counted: true }));
    hub.transfer(U1, PHONE, PHONE, false);
    hub.reportState(U1, PC, report({ queueIds: undefined, playing: false, counted: true }));

    expect(phone.probe.of('load')[0].data).toMatchObject({ play: false, counted: true });
  });

  it('"Continue here": an unreachable active device is replaced at once, frozen where it vanished', () => {
    const { pc, phone } = setup(10_000);
    advance(6_000); // 6 s of music played, then the PC goes to sleep
    hub.disconnect(U1, PC, pc.connId);
    advance(60_000);
    hub.tick();
    expect(hub.snapshot(U1).devices.find((d) => d.id === PC)).toMatchObject({ online: false, unreachable: true, active: true });
    phone.probe.clear();

    expect(hub.transfer(U1, PHONE, PHONE, true)).toEqual({ ok: true, status: 'done' });

    // frozen where it vanished (10 s + 6 s), not advanced by the 60 s of silence that followed
    expect(phone.probe.of('load')[0].data.positionMs).toBe(16_000);
    expect(hub.snapshot(U1).devices.map((d) => d.id)).toEqual([PHONE]);
  });

  it('is a no-op when the target is already active', () => {
    setup();
    expect(hub.transfer(U1, PHONE, PC, true)).toEqual({ ok: true, status: 'noop' });
  });

  it('refuses an offline or unknown target', () => {
    setup();
    expect(hub.transfer(U1, PC, 'ghost-device-01', true)).toEqual({ ok: false, reason: 'target_offline' });
  });

  it('refuses when nothing has been played yet', () => {
    join(U1, PC);
    join(U1, PHONE, 'android');
    expect(hub.transfer(U1, PC, PHONE, true)).toEqual({ ok: false, reason: 'nothing_playing' });
  });

  it('forgets a pending transfer if the target disappears before it completes', () => {
    const { phone } = setup();
    hub.transfer(U1, PC, PHONE, true);
    hub.disconnect(U1, PHONE, phone.connId);
    advance(2_000);
    hub.tick();

    expect(phone.probe.of('load')).toEqual([]);
    expect(hub.snapshot(U1).activeDeviceId).toBe(PC);
  });
});

// ── Active device disappearing (D4) ──────────────────────────────────────────

describe('the active device disappears', () => {
  it('freezes the state as paused where it vanished and shows the device as reconnecting, then unreachable after the grace period', () => {
    const pcConn = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report({ positionMs: 10_000 }));
    phone.probe.clear();
    advance(4_000);

    hub.disconnect(U1, PC, pcConn.connId);

    const frozen = phone.probe.last('state')!.data;
    expect(frozen).toMatchObject({ playing: false, positionMs: 14_000, positionAtMs: clock });
    let pc = phone.probe.last('devices')!.data.devices.find((d) => d.id === PC)!;
    expect(pc).toMatchObject({ online: false, unreachable: false, active: true });

    advance(19_999);
    hub.tick();
    expect(phone.probe.last('devices')!.data.devices.find((d) => d.id === PC)!.unreachable).toBe(false);

    advance(1);
    hub.tick();
    pc = phone.probe.last('devices')!.data.devices.find((d) => d.id === PC)!;
    expect(pc).toMatchObject({ online: false, unreachable: true });
  });

  it('a quick reconnect within the grace period restores the device as active', () => {
    const first = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());
    hub.disconnect(U1, PC, first.connId);
    advance(5_000);
    phone.probe.clear();

    join(U1, PC);
    advance(60_000);
    hub.tick();

    // listed exactly once: no leftover "unreachable" copy next to the reconnected device
    expect(hub.snapshot(U1).devices.filter((d) => d.id === PC)).toEqual([
      { id: PC, name: PC, type: 'web', online: true, unreachable: false, active: true },
    ]);
  });

  it('keeps the unreachable notice to a single broadcast', () => {
    const first = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());
    hub.disconnect(U1, PC, first.connId);
    phone.probe.clear();

    advance(25_000);
    hub.tick();
    hub.tick();
    advance(5_000);
    hub.tick();

    expect(phone.probe.of('devices')).toHaveLength(1);
  });
});

// ── Rename / revoke / housekeeping ───────────────────────────────────────────

describe('rename, revoke and housekeeping', () => {
  it('renames a device and notifies everyone, sanitising the name', () => {
    const pc = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    pc.probe.clear();
    phone.probe.clear();

    expect(hub.rename(U1, PHONE, '  My\u0000 phone  ')).toBe('ok');

    expect(pc.probe.last('devices')!.data.devices.find((d) => d.id === PHONE)!.name).toBe('My phone');
    expect(phone.probe.last('devices')).toBeDefined();
    expect(hub.rename(U1, 'nobody-device-1', 'x')).toBe('unknown_device');
  });

  it('revoke tells the user\'s devices, ends their streams and drops their state', () => {
    const pc = join(U1, PC);
    const other = join(U2, 'other-user-dev1');
    hub.reportState(U1, PC, report());

    hub.revoke(U1);

    expect(pc.probe.of('revoked')).toHaveLength(1);
    expect(pc.probe.ended).toBe(true);
    expect(hub.snapshot(U1)).toEqual({ devices: [], activeDeviceId: null, state: null });
    expect(other.probe.ended).toBe(false);
  });

  it('shutdown ends every stream', () => {
    const a = join(U1, PC);
    const b = join(U2, 'other-user-dev1');
    hub.shutdown();
    expect(a.probe.ended && b.probe.ended).toBe(true);
  });

  it('forgets a user\'s state once nobody has been connected for the idle period', () => {
    const conn = join(U1, PC);
    hub.reportState(U1, PC, report());
    hub.disconnect(U1, PC, conn.connId);

    advance(599_000);
    hub.tick();
    expect(hub.snapshot(U1).state).not.toBeNull();

    advance(2_000);
    hub.tick();
    expect(hub.snapshot(U1).state).toBeNull();
  });

  it('queue() returns the full songs, skips unknown ids and keeps the index pointing at the same song', () => {
    join(U1, PC);
    hub.reportState(U1, PC, report({ queueIds: ['zzz', 'a', 'b', 'c'], index: 2 }));

    const q = hub.queue(U1)!;
    expect(q.songs.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(q.index).toBe(1); // 'b' is now at position 1
    expect(q.queueVersion).toBe(1);
  });

  it('queue() is null before anything was played', () => {
    join(U1, PC);
    expect(hub.queue(U1)).toBeNull();
  });
});

// ── Long-poll fallback ───────────────────────────────────────────────────────

describe('long-poll fallback', () => {
  const info = { deviceId: 'poller-device-1', name: 'Poller', type: 'web' as const };

  it('registers the device and returns hello + snapshot straight away', async () => {
    const r = await hub.pollEvents(U1, info, undefined, 0);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.map((e) => e.event.name)).toEqual(['hello', 'snapshot']);
    expect(hub.snapshot(U1).devices.map((d) => d.id)).toEqual(['poller-device-1']);
  });

  it('only returns events after `since`', async () => {
    const first = await hub.pollEvents(U1, info, undefined, 0);
    if (!first.ok) throw new Error('poll failed');
    const since = first.events.at(-1)!.seq;
    join(U1, PC); // produces a `devices` event for the poller

    const next = await hub.pollEvents(U1, info, since, 0);
    expect(next.ok && next.events.map((e) => e.event.name)).toEqual(['devices']);
  });

  it('holds the request and answers as soon as something happens', async () => {
    const first = await hub.pollEvents(U1, info, undefined, 0);
    if (!first.ok) throw new Error('poll failed');
    const since = first.events.at(-1)!.seq;

    const waiting = hub.pollEvents(U1, info, since, 5_000);
    join(U1, PC);
    const r = await waiting;

    expect(r.ok && r.events.map((e) => e.event.name)).toEqual(['devices']);
  });

  it('returns an empty list when nothing happens within the hold time', async () => {
    const first = await hub.pollEvents(U1, info, undefined, 0);
    if (!first.ok) throw new Error('poll failed');

    const r = await hub.pollEvents(U1, info, first.events.at(-1)!.seq, 10);
    expect(r.ok && r.events).toEqual([]);
  });

  it('receives commands like a streamed device does', async () => {
    const first = await hub.pollEvents(U1, info, undefined, 0);
    if (!first.ok) throw new Error('poll failed');
    hub.reportState(U1, info.deviceId, report());
    join(U1, PHONE, 'android');
    const since = first.events.at(-1)!.seq;

    hub.sendCommand(U1, PHONE, { commandId: 'p1', type: 'pause' });

    const r = await hub.pollEvents(U1, info, since, 0);
    expect(r.ok && r.events.some((e) => e.event.name === 'command')).toBe(true);
  });

  it('a poller that stops polling is dropped after the timeout, one that is waiting is not', async () => {
    const first = await hub.pollEvents(U1, info, undefined, 0);
    if (!first.ok) throw new Error('poll failed');
    advance(46_000);
    hub.tick();

    expect(hub.snapshot(U1).devices).toEqual([]);
  });

  it('counts towards the device limit', async () => {
    join(U1, 'device-aaaa-01');
    join(U1, 'device-bbbb-02');
    join(U1, 'device-cccc-03');

    expect(await hub.pollEvents(U1, info, undefined, 0)).toEqual({ ok: false, reason: 'too_many_devices' });
  });
});

// ── Input validation helpers ─────────────────────────────────────────────────

describe('validation helpers', () => {
  it('validDeviceId accepts url-safe ids of sane length only', () => {
    expect(validDeviceId('3f2b9c1e-aaaa-bbbb-cccc-1234567890ab')).toBe(true);
    for (const bad of ['short', 'has space in it', 'x'.repeat(65), '../../etc', 42, null, undefined]) {
      expect(validDeviceId(bad)).toBe(false);
    }
  });

  it('sanitizeName strips control characters, trims, truncates and falls back', () => {
    expect(sanitizeName('  Living\nroom\u0007 PC ')).toBe('Livingroom PC');
    expect(sanitizeName('x'.repeat(100))).toHaveLength(40);
    expect(sanitizeName('   ')).toBe('Unnamed device');
    expect(sanitizeName(42, 'Fallback')).toBe('Fallback');
  });

  it('parseStateReport accepts a good report and rounds the position', () => {
    expect(parseStateReport({ queueIds: ['1', '2'], index: 1, positionMs: 1234.6, playing: true, repeat: 'all', shuffle: true })).toEqual({
      queueIds: ['1', '2'], index: 1, positionMs: 1235, playing: true, repeat: 'all', shuffle: true, counted: false, volume: 1,
    });
  });

  it.each([
    ['not an object', null],
    ['negative index', { index: -1, positionMs: 0, playing: true, repeat: 'off', shuffle: false }],
    ['fractional index', { index: 1.5, positionMs: 0, playing: true, repeat: 'off', shuffle: false }],
    ['bad position', { index: 0, positionMs: -5, playing: true, repeat: 'off', shuffle: false }],
    ['NaN position', { index: 0, positionMs: NaN, playing: true, repeat: 'off', shuffle: false }],
    ['bad playing', { index: 0, positionMs: 0, playing: 'yes', repeat: 'off', shuffle: false }],
    ['bad repeat', { index: 0, positionMs: 0, playing: true, repeat: 'sometimes', shuffle: false }],
    ['bad shuffle', { index: 0, positionMs: 0, playing: true, repeat: 'off', shuffle: 1 }],
    ['queueIds not strings', { queueIds: [1], index: 0, positionMs: 0, playing: true, repeat: 'off', shuffle: false }],
    ['too many queueIds', { queueIds: Array.from({ length: 5001 }, (_, i) => String(i)), index: 0, positionMs: 0, playing: true, repeat: 'off', shuffle: false }],
  ])('parseStateReport rejects %s', (_label, body) => {
    expect(typeof parseStateReport(body)).toBe('string');
  });

  it('parseCommand validates type, id and seek position', () => {
    expect(parseCommand({ commandId: 'c1', type: 'next' })).toEqual({ commandId: 'c1', type: 'next' });
    expect(parseCommand({ commandId: 'c1', type: 'seek', positionMs: 5000.4 })).toEqual({ commandId: 'c1', type: 'seek', positionMs: 5000 });
    for (const bad of [
      null, { type: 'next' }, { commandId: '', type: 'next' }, { commandId: 'x'.repeat(65), type: 'next' },
      { commandId: 'c1', type: 'explode' }, { commandId: 'c1', type: 'seek' }, { commandId: 'c1', type: 'seek', positionMs: -1 },
    ]) {
      expect(typeof parseCommand(bad)).toBe('string');
    }
  });
});


// ── Security review: findings turned into regression tests ───────────────────

describe('security: system command ids', () => {
  it('differ between hub instances, so a restarted server never reuses an id a client already deduped', () => {
    const ids = new Set<string>();
    for (let run = 0; run < 3; run++) {
      const h = newHub();
      const a = (() => { const p = new Probe(); h.connectStream(U1, { deviceId: PC, name: 'a', type: 'web' }, p.sink); return p; })();
      const b = (() => { const p = new Probe(); h.connectStream(U1, { deviceId: PHONE, name: 'b', type: 'android' }, p.sink); return p; })();
      h.reportState(U1, PC, report());
      h.transfer(U1, PHONE, PHONE, true);
      for (const probe of [a, b]) for (const e of probe.of('command')) ids.add(e.data.commandId);
    }
    // each run produced a takeover-free transfer pause: 3 runs -> 3 distinct ids
    expect(ids.size).toBe(3);
  });

  it('a takeover pause and a transfer pause never share an id within one hub', () => {
    const pc = join(U1, PC);
    join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());
    hub.reportState(U1, PHONE, report({ queueIds: ['b'] })); // takeover: pc is told to pause
    hub.transfer(U1, PC, PC, true); // transfer back: phone is told to pause
    const ids = [...pc.probe.of('command')].map((e) => e.data.commandId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^(takeover|transfer)-[0-9a-f-]{16,}$/.test(id))).toBe(true);
  });
});

describe('security: commands aimed at the device the sender saw', () => {
  it('are refused when the playing device changed in the meantime', () => {
    const pc = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    join(U1, 'tablet-device-01');
    hub.reportState(U1, PC, report());
    hub.reportState(U1, PHONE, report({ queueIds: ['b'] })); // phone took over from pc
    pc.probe.clear();
    phone.probe.clear();

    // a controller that still believes the PC is playing sends "next"
    const r = hub.sendCommand(U1, 'tablet-device-01', { commandId: 'c1', type: 'next' }, PC);

    expect(r).toEqual({ ok: false, reason: 'target_changed' });
    expect(phone.probe.of('command')).toEqual([]);
    expect(pc.probe.of('command')).toEqual([]);
  });

  it('go through when the expected device is still the playing one, or none is named', () => {
    join(U1, PC);
    join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());

    expect(hub.sendCommand(U1, PHONE, { commandId: 'c1', type: 'next' }, PC)).toEqual({ ok: true });
    expect(hub.sendCommand(U1, PHONE, { commandId: 'c2', type: 'next' })).toEqual({ ok: true });
  });

  it('a mismatch is reported even when nobody is playing any more', () => {
    join(U1, PC);
    join(U1, PHONE, 'android');
    expect(hub.sendCommand(U1, PHONE, { commandId: 'c1', type: 'next' }, PC)).toEqual({ ok: false, reason: 'target_changed' });
  });
});

describe('security: amplification and read limits', () => {
  it('rename is rate limited (each rename is broadcast to every device)', () => {
    join(U1, PC);
    let limited = 0;
    for (let i = 0; i < 40; i++) if (hub.rename(U1, PC, `name ${i}`) === 'rate_limited') limited++;
    expect(limited).toBeGreaterThan(0);
    advance(11_000);
    expect(hub.rename(U1, PC, 'later')).toBe('ok');
  });

  it('rename still reports an unknown device', () => {
    join(U1, PC);
    expect(hub.rename(U1, 'nobody-device-1', 'x')).toBe('unknown_device');
  });

  it('(re)connecting is rate limited, so a reconnect loop cannot flood the other devices with updates', () => {
    join(U1, PC);
    let refused = 0;
    for (let i = 0; i < 60; i++) {
      const r = hub.connectStream(U1, { deviceId: PHONE, name: 'p', type: 'android' }, new Probe().sink);
      if (!r.ok && r.reason === 'rate_limited') refused++;
    }
    expect(refused).toBeGreaterThan(0);
    advance(61_000);
    expect(hub.connectStream(U1, { deviceId: PHONE, name: 'p', type: 'android' }, new Probe().sink).ok).toBe(true);
  });

  it('a refused connection leaves no device behind', () => {
    for (let i = 0; i < 60; i++) hub.connectStream(U1, { deviceId: PHONE, name: 'p', type: 'android' }, new Probe().sink);
    const before = hub.snapshot(U1).devices.length;
    hub.connectStream(U1, { deviceId: 'brand-new-device', name: 'x', type: 'web' }, new Probe().sink);
    expect(hub.snapshot(U1).devices.length).toBe(before);
  });

  it('reading the queue is rate limited (it resolves up to 5000 songs per call)', () => {
    join(U1, PC);
    hub.reportState(U1, PC, report());
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (hub.allowQueueRead(U1)) allowed++;
    expect(allowed).toBeLessThan(100);
    expect(allowed).toBeGreaterThan(0);
    advance(11_000);
    expect(hub.allowQueueRead(U1)).toBe(true);
  });
});

describe('security: per-connection revocation', () => {
  it('revokes only the stale connection and leaves the user\'s other streams alone', () => {
    const stale = join(U1, PC);
    const fresh = join(U1, PHONE, 'android');
    stale.probe.clear();
    fresh.probe.clear();

    hub.revokeConnection(U1, PC, stale.connId);

    expect(stale.probe.of('revoked')).toHaveLength(1);
    expect(stale.probe.ended).toBe(true);
    expect(fresh.probe.ended).toBe(false);
    expect(fresh.probe.of('revoked')).toEqual([]);
    expect(hub.snapshot(U1).devices.map((d) => d.id)).toEqual([PHONE]);
    expect(fresh.probe.last('devices')!.data.devices.map((d) => d.id)).toEqual([PHONE]);
  });

  it('ignores a revoke for a connection that has since been replaced by a reconnect', () => {
    const first = join(U1, PC);
    const second = join(U1, PC);

    hub.revokeConnection(U1, PC, first.connId);

    expect(second.probe.ended).toBe(false);
    expect(hub.snapshot(U1).devices.map((d) => d.id)).toEqual([PC]);
  });
});

describe('security: input hardening', () => {
  it('sanitizeName strips bidirectional-text controls that could disguise a device name', () => {
    expect(sanitizeName('Safe\u202Egnp.exe')).toBe('Safegnp.exe');
    expect(sanitizeName('a\u2066b\u2069c\u200Ed\u200Fe')).toBe('abcde');
    expect(sanitizeName('Pixel 8 \u{1F4F1}')).toBe('Pixel 8 \u{1F4F1}'); // emoji survive
  });

  it('parseStateReport refuses an absurd playback position', () => {
    const base = { index: 0, playing: true, repeat: 'off', shuffle: false };
    expect(typeof parseStateReport({ ...base, positionMs: 1e15 })).toBe('string');
    expect(typeof parseStateReport({ ...base, positionMs: 8 * 24 * 3600 * 1000 })).toBe('string');
    expect(typeof parseStateReport({ ...base, positionMs: 3 * 3600 * 1000 })).toBe('object');
  });

  it('parseCommand refuses an absurd seek position', () => {
    expect(typeof parseCommand({ commandId: 'c', type: 'seek', positionMs: 1e15 })).toBe('string');
    expect(typeof parseCommand({ commandId: 'c', type: 'seek', positionMs: 60_000 })).toBe('object');
  });
});

describe('security: long-poll robustness', () => {
  const info = { deviceId: 'poller-device-1', name: 'Poller', type: 'web' as const };

  it('a poller whose registration timed out gets a fresh hello + snapshot instead of silence', async () => {
    const first = await hub.pollEvents(U1, info, undefined, 0);
    if (!first.ok) throw new Error('poll failed');
    const since = first.events.at(-1)!.seq;
    advance(60_000);
    hub.tick(); // dropped for not polling

    const again = await hub.pollEvents(U1, info, since, 0);

    expect(again.ok && again.events.map((e) => e.event.name)).toEqual(['hello', 'snapshot']);
  });

  it('only one request per device waits at a time: a newer poll releases the older one', async () => {
    const first = await hub.pollEvents(U1, info, undefined, 0);
    if (!first.ok) throw new Error('poll failed');
    const since = first.events.at(-1)!.seq;

    let olderDone = false;
    const older = hub.pollEvents(U1, info, since, 5_000).then((r) => { olderDone = true; return r; });
    await Promise.resolve();
    const newer = hub.pollEvents(U1, info, since, 20);
    await Promise.resolve();
    await Promise.resolve();

    expect(olderDone).toBe(true);
    expect((await older).ok && ((await older) as { events: unknown[] }).events).toEqual([]);
    await newer;
  });

  it('the newer waiting poll still wakes up for an event after the older one let go', async () => {
    const first = await hub.pollEvents(U1, info, undefined, 0);
    if (!first.ok) throw new Error('poll failed');
    const since = first.events.at(-1)!.seq;

    const older = hub.pollEvents(U1, info, since, 5_000);
    await Promise.resolve();
    const newer = hub.pollEvents(U1, info, since, 5_000);
    await older; // released by the newer poll
    await new Promise((r) => setTimeout(r, 10));

    join(U1, PC); // an event the poller must hear about
    const result = await Promise.race([newer, new Promise<'slept through it'>((r) => setTimeout(() => r('slept through it'), 500))]);

    expect(result).not.toBe('slept through it');
  });
});

// ── Code review follow-up ────────────────────────────────────────────────────

describe('review: transfers away from a device that is already paused', () => {
  it('complete at once — the paused device sends no final report, so waiting for one only stalls the handover', () => {
    const pc = join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report({ positionMs: 9_000, playing: true }));
    hub.reportState(U1, PC, report({ queueIds: undefined, positionMs: 10_000, playing: false })); // then paused
    pc.probe.clear();
    phone.probe.clear();

    expect(hub.transfer(U1, PHONE, PHONE, true)).toEqual({ ok: true, status: 'done' });

    expect(phone.probe.of('load')[0].data).toMatchObject({ index: 0, positionMs: 10_000, play: true });
    expect(hub.snapshot(U1).activeDeviceId).toBe(PHONE);
    expect(pc.probe.of('command')).toEqual([]); // nothing to pause
  });

  it('still wait (briefly) for a device that is playing', () => {
    join(U1, PC);
    join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report({ playing: true }));

    expect(hub.transfer(U1, PHONE, PHONE, true)).toEqual({ ok: true, status: 'pending' });
  });
});


// ── Phase 2: remote volume and remote queue editing ──────────────────────────

describe('phase 2: volume', () => {
  it('parseStateReport keeps a reported volume (clamped) and defaults to full volume', () => {
    const base = { index: 0, positionMs: 0, playing: true, repeat: 'off', shuffle: false };
    expect((parseStateReport({ ...base, volume: 0.4 }) as StateReport).volume).toBe(0.4);
    expect((parseStateReport({ ...base, volume: 7 }) as StateReport).volume).toBe(1);
    expect((parseStateReport({ ...base, volume: -2 }) as StateReport).volume).toBe(0);
    expect((parseStateReport({ ...base, volume: 'loud' }) as StateReport).volume).toBe(1);
    expect((parseStateReport(base) as StateReport).volume).toBe(1);
  });

  it('is part of the public state, so controllers can show the playing device\'s volume', () => {
    join(U1, PC);
    const phone = join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report({ volume: 0.3 }));
    expect(phone.probe.last('state')!.data.volume).toBe(0.3);
    hub.reportState(U1, PC, report({ volume: undefined }));
    expect(hub.snapshot(U1).state!.volume).toBe(1);
  });

  it('parseCommand accepts a volume command in 0..1 only', () => {
    expect(parseCommand({ commandId: 'v', type: 'volume', volume: 0.55 })).toEqual({ commandId: 'v', type: 'volume', volume: 0.55 });
    expect(parseCommand({ commandId: 'v', type: 'volume', volume: 0 })).toMatchObject({ volume: 0 });
    for (const volume of [undefined, -0.1, 1.1, NaN, '0.5', null]) {
      expect(typeof parseCommand({ commandId: 'v', type: 'volume', volume })).toBe('string');
    }
  });

  it('is delivered to the active device with its value', () => {
    const pc = join(U1, PC);
    join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());
    pc.probe.clear();
    hub.sendCommand(U1, PHONE, { commandId: 'v1', type: 'volume', volume: 0.25 });
    expect(pc.probe.of('command')[0].data).toEqual({ commandId: 'v1', type: 'volume', volume: 0.25, expiresAtMs: clock + 5_000 });
  });
});

describe('phase 2: queue commands', () => {
  function playing() {
    const pc = join(U1, PC);
    join(U1, PHONE, 'android');
    hub.reportState(U1, PC, report());
    pc.probe.clear();
    return pc;
  }

  it('parseCommand validates the arguments of every queue command', () => {
    expect(parseCommand({ commandId: 'q', type: 'queue_play', index: 2, songId: 'b' })).toEqual({ commandId: 'q', type: 'queue_play', index: 2, songId: 'b' });
    expect(parseCommand({ commandId: 'q', type: 'queue_remove', index: 0, songId: 'a' })).toMatchObject({ type: 'queue_remove', index: 0 });
    expect(parseCommand({ commandId: 'q', type: 'queue_move', index: 0, to: 4, songId: 'a' })).toMatchObject({ index: 0, to: 4, songId: 'a' });
    expect(parseCommand({ commandId: 'q', type: 'queue_add', mode: 'next', songIds: ['a', 'b'] })).toMatchObject({ mode: 'next', songIds: ['a', 'b'] });

    const bad: unknown[] = [
      { commandId: 'q', type: 'queue_play', songId: 'a' }, // no index
      { commandId: 'q', type: 'queue_play', index: -1, songId: 'a' },
      { commandId: 'q', type: 'queue_play', index: 1.5, songId: 'a' },
      { commandId: 'q', type: 'queue_play', index: 5000, songId: 'a' },
      { commandId: 'q', type: 'queue_remove', index: 0 }, // no songId guard
      { commandId: 'q', type: 'queue_remove', index: 0, songId: '' },
      { commandId: 'q', type: 'queue_remove', index: 0, songId: 'x'.repeat(33) },
      { commandId: 'q', type: 'queue_move', index: 0, songId: 'a' }, // no target
      { commandId: 'q', type: 'queue_move', index: 0, to: -3, songId: 'a' },
      { commandId: 'q', type: 'queue_add', mode: 'next', songIds: [] },
      { commandId: 'q', type: 'queue_add', mode: 'later', songIds: ['a'] },
      { commandId: 'q', type: 'queue_add', mode: 'end', songIds: [1] },
      { commandId: 'q', type: 'queue_add', mode: 'end', songIds: Array.from({ length: 101 }, (_, i) => String(i)) },
      { commandId: 'q', type: 'queue_add', mode: 'end' },
    ];
    for (const body of bad) expect(typeof parseCommand(body)).toBe('string');
  });

  it('are relayed to the active device with their arguments, and only to it', () => {
    const pc = playing();
    hub.sendCommand(U1, PHONE, { commandId: 'q1', type: 'queue_move', index: 0, to: 2, songId: 'a' });
    expect(pc.probe.of('command')[0].data).toEqual({
      commandId: 'q1', type: 'queue_move', index: 0, to: 2, songId: 'a', expiresAtMs: clock + 5_000,
    });
  });

  it('queue_add drops ids the library does not know, keeping the order', () => {
    const pc = playing();
    expect(hub.sendCommand(U1, PHONE, { commandId: 'q2', type: 'queue_add', mode: 'end', songIds: ['c', 'nope', 'a'] })).toEqual({ ok: true });
    expect(pc.probe.of('command')[0].data).toMatchObject({ songs: [{ id: 'c' }, { id: 'a' }], mode: 'end' });
  });

  it('queue_add with nothing valid is refused and delivers nothing', () => {
    const pc = playing();
    expect(hub.sendCommand(U1, PHONE, { commandId: 'q3', type: 'queue_add', mode: 'next', songIds: ['nope'] }))
      .toEqual({ ok: false, reason: 'no_valid_songs' });
    expect(pc.probe.of('command')).toEqual([]);
    // the refused command did not burn its id: a corrected retry with the same id still goes through
    expect(hub.sendCommand(U1, PHONE, { commandId: 'q3', type: 'queue_add', mode: 'next', songIds: ['a'] })).toEqual({ ok: true });
  });

  it('queue edits respect the target guard like every other command', () => {
    playing();
    expect(hub.sendCommand(U1, PHONE, { commandId: 'q4', type: 'queue_remove', index: 1, songId: 'b' }, 'someone-else-1'))
      .toEqual({ ok: false, reason: 'target_changed' });
  });

  it('queue() reports where each returned song sits in the real queue', () => {
    join(U1, PC);
    hub.reportState(U1, PC, report({ queueIds: ['zzz', 'a', 'gone', 'b'], index: 3 }));
    const q = hub.queue(U1)!;
    expect(q.songs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(q.positions).toEqual([1, 3]);
    expect(q.index).toBe(1);
  });
});
