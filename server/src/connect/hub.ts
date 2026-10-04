// RiffPlayer Connect — in-memory registry + relay for one user's devices.
//
// Pure logic, no HTTP: transports (SSE stream / long-poll) hand in a sink and the
// routes translate requests into method calls. Time comes from an injectable clock and
// nothing here owns a timer (the plugin calls tick()), so every rule is unit-testable.
// See docs/CONNECT-DESIGN.md for the full design.

import { randomUUID } from 'node:crypto';

export type DeviceType = 'web' | 'android' | 'desktop';
export const DEVICE_TYPES: readonly DeviceType[] = ['web', 'android', 'desktop'];

export const COMMAND_TYPES = [
  'play', 'pause', 'next', 'previous', 'seek',
  // Phase 2: remote volume and remote queue editing.
  'volume', 'queue_play', 'queue_remove', 'queue_move', 'queue_add',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export type QueueAddMode = 'next' | 'end';
const QUEUE_ADD_MODES: readonly QueueAddMode[] = ['next', 'end'];
/** Songs one `queue_add` command may carry (an album is far below this). */
export const MAX_QUEUE_ADD = 100;

/** The arguments of a command beyond its type; which ones are present depends on the type. */
export interface CommandArgs {
  positionMs?: number;
  /** 0..1 */
  volume?: number;
  /** queue_play / queue_remove: position in the queue. queue_move: where the song is now (`from`). */
  index?: number;
  to?: number;
  /**
   * The song the sender saw at `index`. The queue may have changed since the sender looked at it, and an
   * index alone would then hit the wrong song — the device ignores the command if the ids differ.
   */
  songId?: string;
  songIds?: string[];
  mode?: QueueAddMode;
}

export type RepeatMode = 'off' | 'all' | 'one';
const REPEAT_MODES: readonly RepeatMode[] = ['off', 'all', 'one'];

export interface DeviceInfo {
  id: string;
  name: string;
  type: DeviceType;
  /** Connected right now. */
  online: boolean;
  /** Offline for longer than the grace period — controllers may offer "Continue here". */
  unreachable: boolean;
  active: boolean;
}

export interface PublicState {
  activeDeviceId: string;
  playing: boolean;
  song: Record<string, unknown> | null;
  index: number;
  queueLength: number;
  queueVersion: number;
  positionMs: number;
  /** Server clock at which `positionMs` was true; controllers extrapolate while playing. */
  positionAtMs: number;
  durationMs: number | null;
  repeat: RepeatMode;
  shuffle: boolean;
  /** The current play was already counted (scrobbled) by the reporting device. */
  counted: boolean;
  /** The playing device's own player volume, 0..1 (1 if it doesn't say). */
  volume: number;
}

export type ConnectEvent =
  | { name: 'hello'; data: { serverTimeMs: number; you: string } }
  | { name: 'snapshot'; data: { devices: DeviceInfo[]; activeDeviceId: string | null; state: PublicState | null } }
  | { name: 'devices'; data: { devices: DeviceInfo[]; activeDeviceId: string | null } }
  | { name: 'state'; data: PublicState }
  | { name: 'command'; data: { commandId: string; type: CommandType; expiresAtMs: number } & CommandArgs }
  | { name: 'load'; data: { queueVersion: number; index: number; positionMs: number; play: boolean; counted: boolean } }
  | { name: 'revoked'; data: Record<string, never> };

export interface StreamSink {
  send(seq: number, event: ConnectEvent): void;
  end(): void;
}

export interface ResolvedSong {
  id: string;
  durationMs: number | null;
  json: Record<string, unknown>;
}
export type SongResolver = (userId: number, ids: string[]) => ResolvedSong[];

export interface StateReport {
  queueIds?: string[];
  index: number;
  positionMs: number;
  playing: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  counted: boolean;
  /** 0..1; a client that doesn't report it is treated as playing at full volume. */
  volume?: number;
}

export interface HubOptions {
  resolveSongs: SongResolver;
  now?: () => number;
  /** How long an active device may be offline before it counts as unreachable. */
  graceMs?: number;
  /** How long a transfer waits for the old active device's final position. */
  transferWaitMs?: number;
  commandTtlMs?: number;
  /** A long-poll device that hasn't polled for this long is gone. */
  pollTimeoutMs?: number;
  maxDevices?: number;
  /** How long a user's state is kept after their last device left. */
  idleStateMs?: number;
}

export const MAX_QUEUE_IDS = 5000;
const MAX_NAME_LENGTH = 40;
const POLL_BUFFER = 200;
const RECENT_COMMANDS = 200;

// Per-user request budgets (sliding window) — cheap protection against a runaway client.
const LIMITS = {
  command: { max: 60, windowMs: 10_000 },
  state: { max: 120, windowMs: 10_000 },
  // Each of these makes the server do work or tell every other device about it, so they are bounded too.
  queue: { max: 20, windowMs: 10_000 }, // resolves up to MAX_QUEUE_IDS songs per call
  rename: { max: 10, windowMs: 10_000 }, // broadcast to every device
  connect: { max: 30, windowMs: 60_000 }, // every (re)connect is broadcast to every device
} as const;

/** No real track or seek is longer than this; anything bigger is a bug or an attack. */
export const MAX_POSITION_MS = 7 * 24 * 3600 * 1000;

type Bucket = keyof typeof LIMITS;

interface Device {
  id: string;
  name: string;
  type: DeviceType;
  transport: 'stream' | 'poll';
  connId: number;
  sink?: StreamSink;
  seq: number;
  buffer: { seq: number; event: ConnectEvent }[];
  wake?: () => void;
  lastSeen: number;
}

interface Ghost {
  id: string;
  name: string;
  type: DeviceType;
  since: number;
  unreachable: boolean;
}

interface StoredState {
  playing: boolean;
  index: number;
  positionMs: number;
  positionAtMs: number;
  repeat: RepeatMode;
  shuffle: boolean;
  counted: boolean;
  volume: number;
  queueVersion: number;
  durationMs: number | null;
  song: Record<string, unknown> | null;
}

interface PendingTransfer {
  toDeviceId: string;
  play: boolean;
  deadline: number;
}

interface UserHub {
  devices: Map<string, Device>;
  activeDeviceId: string | null;
  ghost: Ghost | null;
  state: StoredState | null;
  queueIds: string[];
  queueVersion: number;
  pending: PendingTransfer | null;
  recentCommands: string[];
  hits: Record<Bucket, number[]>;
  emptySince: number | null;
}

// ── Validation helpers (shared with the routes) ──────────────────────────────

export function validDeviceId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

export function sanitizeName(v: unknown, fallback = 'Unnamed device'): string {
  if (typeof v !== 'string') return fallback;
  // Control characters, and the bidirectional-text overrides that can make one device's name pass for another's.
  const cleaned = v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || fallback;
}

export function parseDeviceType(v: unknown): DeviceType {
  return DEVICE_TYPES.includes(v as DeviceType) ? (v as DeviceType) : 'web';
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Returns the cleaned report, or a message describing what is wrong. */
export function parseStateReport(body: unknown): StateReport | string {
  if (typeof body !== 'object' || body === null) return 'JSON body required';
  const b = body as Record<string, unknown>;

  let queueIds: string[] | undefined;
  if (b.queueIds !== undefined) {
    if (!Array.isArray(b.queueIds) || b.queueIds.length > MAX_QUEUE_IDS) return `queueIds must be an array of at most ${MAX_QUEUE_IDS} ids`;
    if (!b.queueIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 32)) return 'queueIds must be non-empty strings';
    queueIds = b.queueIds as string[];
  }
  if (!Number.isInteger(b.index) || (b.index as number) < 0) return 'index must be a non-negative integer';
  if (!isFiniteNumber(b.positionMs) || b.positionMs < 0 || b.positionMs > MAX_POSITION_MS) return 'positionMs must be a sane non-negative number';
  if (typeof b.playing !== 'boolean') return 'playing must be a boolean';
  if (!REPEAT_MODES.includes(b.repeat as RepeatMode)) return 'repeat must be off, all or one';
  if (typeof b.shuffle !== 'boolean') return 'shuffle must be a boolean';

  return {
    queueIds,
    index: b.index as number,
    positionMs: Math.round(b.positionMs),
    playing: b.playing,
    repeat: b.repeat as RepeatMode,
    shuffle: b.shuffle,
    counted: b.counted === true,
    // Older clients don't report a volume: treat them as full volume.
    volume: isFiniteNumber(b.volume) ? clamp01(b.volume) : 1,
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
const isQueueIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAX_QUEUE_IDS;
const isSongId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 32;

export interface CommandInput extends CommandArgs {
  commandId: string;
  type: CommandType;
}

export function parseCommand(body: unknown): CommandInput | string {
  if (typeof body !== 'object' || body === null) return 'JSON body required';
  const b = body as Record<string, unknown>;
  if (typeof b.commandId !== 'string' || !b.commandId || b.commandId.length > 64) return 'commandId (string, max 64) required';
  if (!COMMAND_TYPES.includes(b.type as CommandType)) return `type must be one of ${COMMAND_TYPES.join(', ')}`;
  const base = { commandId: b.commandId, type: b.type as CommandType };

  switch (b.type as CommandType) {
    case 'seek':
      if (!isFiniteNumber(b.positionMs) || b.positionMs < 0 || b.positionMs > MAX_POSITION_MS) return 'seek needs a sane non-negative positionMs';
      return { ...base, positionMs: Math.round(b.positionMs) };
    case 'volume':
      if (!isFiniteNumber(b.volume) || b.volume < 0 || b.volume > 1) return 'volume needs a number between 0 and 1';
      return { ...base, volume: clamp01(b.volume) };
    case 'queue_play':
    case 'queue_remove':
      if (!isQueueIndex(b.index)) return 'index must be a valid queue position';
      if (!isSongId(b.songId)) return 'songId (string, max 32) required';
      return { ...base, index: b.index, songId: b.songId };
    case 'queue_move':
      if (!isQueueIndex(b.index) || !isQueueIndex(b.to)) return 'index and to must be valid queue positions';
      if (!isSongId(b.songId)) return 'songId (string, max 32) required';
      return { ...base, index: b.index, to: b.to, songId: b.songId };
    case 'queue_add': {
      if (!QUEUE_ADD_MODES.includes(b.mode as QueueAddMode)) return 'mode must be next or end';
      if (!Array.isArray(b.songIds) || b.songIds.length === 0 || b.songIds.length > MAX_QUEUE_ADD) {
        return `songIds must be 1-${MAX_QUEUE_ADD} ids`;
      }
      if (!b.songIds.every(isSongId)) return 'songIds must be non-empty strings';
      return { ...base, songIds: b.songIds as string[], mode: b.mode as QueueAddMode };
    }
    default:
      return base;
  }
}

// ── Hub ──────────────────────────────────────────────────────────────────────

export class ConnectHub {
  private readonly users = new Map<number, UserHub>();
  private readonly now: () => number;
  private readonly resolveSongs: SongResolver;
  private readonly graceMs: number;
  private readonly transferWaitMs: number;
  private readonly commandTtlMs: number;
  private readonly pollTimeoutMs: number;
  private readonly maxDevices: number;
  private readonly idleStateMs: number;
  private nextConnId = 1;

  constructor(opts: HubOptions) {
    this.resolveSongs = opts.resolveSongs;
    this.now = opts.now ?? Date.now;
    this.graceMs = opts.graceMs ?? 20_000;
    this.transferWaitMs = opts.transferWaitMs ?? 1_500;
    this.commandTtlMs = opts.commandTtlMs ?? 5_000;
    this.pollTimeoutMs = opts.pollTimeoutMs ?? 45_000;
    this.maxDevices = opts.maxDevices ?? 10;
    this.idleStateMs = opts.idleStateMs ?? 10 * 60_000;
  }

  // ── Connections ────────────────────────────────────────────────────────────

  /** Registers a device on an SSE stream. A second connection with the same deviceId replaces the first. */
  connectStream(
    userId: number,
    info: { deviceId: string; name: string; type: DeviceType },
    sink: StreamSink,
  ): { ok: true; connId: number } | { ok: false; reason: 'too_many_devices' | 'rate_limited' } {
    const device = this.register(userId, info, 'stream', sink);
    if (typeof device === 'string') return { ok: false, reason: device };
    return { ok: true, connId: device.connId };
  }

  /** Called when a stream closes. Ignored if the device has since reconnected (different connId). */
  disconnect(userId: number, deviceId: string, connId: number): void {
    const hub = this.users.get(userId);
    const device = hub?.devices.get(deviceId);
    if (!hub || !device || device.connId !== connId) return;
    this.removeDevice(hub, device);
  }

  /**
   * Long-poll fallback: registers the device on first use, then returns the events with
   * `seq > since` — immediately if there are any, otherwise as soon as one arrives or after `holdMs`.
   */
  async pollEvents(
    userId: number,
    info: { deviceId: string; name: string; type: DeviceType },
    since: number | undefined,
    holdMs: number,
  ): Promise<{ ok: true; events: { seq: number; event: ConnectEvent }[] } | { ok: false; reason: 'too_many_devices' | 'rate_limited' }> {
    const hub = this.users.get(userId);
    let device = hub?.devices.get(info.deviceId);
    let registeredNow = false;
    // A stream-connected device can't also poll; a (re)started poller starts a new connection.
    if (!device || device.transport !== 'poll' || since === undefined) {
      const registered = this.register(userId, info, 'poll');
      if (typeof registered === 'string') return { ok: false, reason: registered };
      device = registered;
      registeredNow = true;
    }
    const polled = device;
    polled.lastSeen = this.now();
    // A device that had to be registered anew (its old registration timed out) numbers its events from 1
    // again, so the caller's old `since` means nothing: start from the beginning.
    const after = registeredNow ? 0 : (since ?? 0);

    const pending = () => polled.buffer.filter((e) => e.seq > after);
    if (pending().length === 0 && holdMs > 0) {
      // Only one request per device waits at a time: a newer poll releases the older one at once, so a
      // client can't pile up held requests.
      polled.wake?.();
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, holdMs);
        release = () => { clearTimeout(timer); resolve(); };
      });
      polled.wake = release;
      await waiting;
      if (polled.wake === release) polled.wake = undefined; // not if a newer poll already took over
    }
    polled.lastSeen = this.now();
    return { ok: true, events: pending() };
  }

  // ── State from the active device ───────────────────────────────────────────

  reportState(
    userId: number,
    deviceId: string,
    report: StateReport,
  ): { ok: true; takeover?: boolean } | { ok: false; reason: 'unknown_device' | 'not_active' | 'need_queue' | 'rate_limited' } {
    const hub = this.users.get(userId);
    const device = hub?.devices.get(deviceId);
    if (!hub || !device) return { ok: false, reason: 'unknown_device' };
    if (!this.allow(hub, 'state')) return { ok: false, reason: 'rate_limited' };

    const isActive = hub.activeDeviceId === deviceId;
    let takeover = false;

    if (!isActive) {
      // Only a device that actually starts playing may take over (D1); a paused report from a bystander is noise.
      if (!report.playing) return { ok: false, reason: 'not_active' };
      // Taking over needs the queue, since the server may never have seen it.
      if (!report.queueIds) return { ok: false, reason: 'need_queue' };
      takeover = true;
    } else if (!report.queueIds && hub.queueIds.length === 0) {
      // The server lost its state (restart) — ask the active device to resend the queue.
      return { ok: false, reason: 'need_queue' };
    }

    if (takeover) {
      const previous = hub.activeDeviceId ? hub.devices.get(hub.activeDeviceId) : undefined;
      if (previous && previous.id !== deviceId) {
        this.emit(previous, {
          name: 'command',
          data: {
            commandId: `takeover-${randomUUID()}`,
            type: 'pause',
            expiresAtMs: this.now() + this.commandTtlMs,
          },
        });
      }
      hub.activeDeviceId = deviceId;
      hub.ghost = null;
      hub.pending = null;
    }

    this.applyReport(userId, hub, report);

    if (takeover) this.broadcastDevices(hub);
    this.broadcastState(hub, deviceId);

    // The old active device's "I have paused" report is the final position a waiting transfer needs.
    // (A report that still says playing is a stale periodic one — the deadline covers that case.)
    if (hub.pending && isActive && !report.playing) this.completeTransfer(hub);

    return { ok: true, takeover };
  }

  // ── Commands and transfer ──────────────────────────────────────────────────

  sendCommand(
    userId: number,
    fromDeviceId: string,
    cmd: CommandInput,
    expectedActiveId?: string,
  ):
    | { ok: true; duplicate?: boolean }
    | { ok: false; reason: 'unknown_device' | 'no_active_device' | 'self' | 'rate_limited' | 'target_changed' | 'no_valid_songs' } {
    const hub = this.users.get(userId);
    if (!hub?.devices.has(fromDeviceId)) return { ok: false, reason: 'unknown_device' };
    if (!this.allow(hub, 'command')) return { ok: false, reason: 'rate_limited' };

    if (hub.recentCommands.includes(cmd.commandId)) return { ok: true, duplicate: true };
    // The sender aimed at the device it saw playing; if another one took over since, the command must not
    // land on the new one (a "next" meant for the PC would skip a track on the phone).
    if (expectedActiveId !== undefined && hub.activeDeviceId !== expectedActiveId) {
      return { ok: false, reason: 'target_changed' };
    }
    const target = hub.activeDeviceId ? hub.devices.get(hub.activeDeviceId) : undefined;
    if (!target) return { ok: false, reason: 'no_active_device' };
    if (target.id === fromDeviceId) return { ok: false, reason: 'self' };

    // Only songs this user can actually play may be put into a queue; the rest are dropped (order kept).
    let songIds = cmd.songIds;
    if (cmd.type === 'queue_add' && songIds) {
      const known = new Set(this.resolveSongs(userId, songIds).map((s) => s.id));
      songIds = songIds.filter((id) => known.has(id));
      if (songIds.length === 0) return { ok: false, reason: 'no_valid_songs' };
    }

    hub.recentCommands.push(cmd.commandId);
    if (hub.recentCommands.length > RECENT_COMMANDS) hub.recentCommands.shift();

    const { commandId, type, ...args } = cmd;
    this.emit(target, {
      name: 'command',
      data: {
        commandId,
        type,
        ...args,
        ...(songIds ? { songIds } : {}),
        expiresAtMs: this.now() + this.commandTtlMs,
      },
    });
    return { ok: true };
  }

  /**
   * Moves playback to `toDeviceId` (which may be the caller — "Continue here").
   * If the current device is reachable it is paused first and the hub waits briefly for its final
   * position (status 'pending'); otherwise the last known state is used straight away.
   */
  transfer(
    userId: number,
    fromDeviceId: string,
    toDeviceId: string,
    play: boolean,
  ):
    | { ok: true; status: 'done' | 'pending' | 'noop' }
    | { ok: false; reason: 'unknown_device' | 'target_offline' | 'nothing_playing' | 'rate_limited' } {
    const hub = this.users.get(userId);
    if (!hub?.devices.has(fromDeviceId)) return { ok: false, reason: 'unknown_device' };
    if (!this.allow(hub, 'command')) return { ok: false, reason: 'rate_limited' };
    if (!hub.devices.has(toDeviceId)) return { ok: false, reason: 'target_offline' };
    if (hub.activeDeviceId === toDeviceId) return { ok: true, status: 'noop' };
    if (!hub.state || hub.queueIds.length === 0) return { ok: false, reason: 'nothing_playing' };

    const current = hub.activeDeviceId ? hub.devices.get(hub.activeDeviceId) : undefined;
    hub.pending = { toDeviceId, play, deadline: this.now() + this.transferWaitMs };

    // Only a device that is actually playing has a "final position" worth waiting for. A paused one is
    // frozen already and would send no report at all, so waiting would just stall the handover.
    if (current && hub.state.playing) {
      // Ask the old device to stop; its next state report (or the deadline) completes the transfer.
      this.emit(current, {
        name: 'command',
        data: {
          commandId: `transfer-${randomUUID()}`,
          type: 'pause',
          expiresAtMs: this.now() + this.commandTtlMs,
        },
      });
      return { ok: true, status: 'pending' };
    }

    this.completeTransfer(hub);
    return { ok: true, status: 'done' };
  }

  rename(userId: number, deviceId: string, name: string): 'ok' | 'unknown_device' | 'rate_limited' {
    const hub = this.users.get(userId);
    const device = hub?.devices.get(deviceId);
    if (!hub || !device) return 'unknown_device';
    if (!this.allow(hub, 'rename')) return 'rate_limited';
    device.name = sanitizeName(name, device.name);
    this.broadcastDevices(hub);
    return 'ok';
  }

  /** Whether this user may fetch the full queue now (it costs up to MAX_QUEUE_IDS song lookups). */
  allowQueueRead(userId: number): boolean {
    const hub = this.users.get(userId);
    return hub ? this.allow(hub, 'queue') : true;
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  snapshot(userId: number): { devices: DeviceInfo[]; activeDeviceId: string | null; state: PublicState | null } {
    const hub = this.users.get(userId);
    if (!hub) return { devices: [], activeDeviceId: null, state: null };
    return { devices: this.deviceList(hub), activeDeviceId: hub.activeDeviceId, state: this.publicState(hub) };
  }

  /** The queue as full songs (unknown ids dropped) and the index of the current song within them. */
  queue(userId: number): { queueVersion: number; index: number; songs: Record<string, unknown>[]; positions: number[] } | null {
    const hub = this.users.get(userId);
    if (!hub || !hub.state || hub.queueIds.length === 0) return null;
    const resolved = new Map(this.resolveSongs(userId, hub.queueIds).map((s) => [s.id, s]));
    const songs: Record<string, unknown>[] = [];
    // Where each returned song sits in the real queue: ids the library no longer knows are skipped, which
    // shifts everything after them, and queue edits are addressed by real position.
    const positions: number[] = [];
    let index = 0;
    hub.queueIds.forEach((id, i) => {
      const song = resolved.get(id);
      if (!song) return;
      if (i < hub.state!.index) index++;
      songs.push(song.json);
      positions.push(i);
    });
    return { queueVersion: hub.queueVersion, index: Math.min(index, Math.max(0, songs.length - 1)), songs, positions };
  }

  // ── Time-driven housekeeping (called by the plugin every few seconds) ───────

  tick(): void {
    const now = this.now();
    for (const [userId, hub] of this.users) {
      // Long-poll devices that stopped polling are gone.
      for (const device of [...hub.devices.values()]) {
        if (device.transport === 'poll' && !device.wake && now - device.lastSeen > this.pollTimeoutMs) {
          this.removeDevice(hub, device);
        }
      }
      // A transfer that never got the old device's final position proceeds with what we know.
      if (hub.pending && now >= hub.pending.deadline) this.completeTransfer(hub);
      // The active device has been gone past the grace period.
      if (hub.ghost && !hub.ghost.unreachable && now - hub.ghost.since >= this.graceMs) {
        hub.ghost.unreachable = true;
        this.broadcastDevices(hub);
      }
      // Forget users nobody is connected for any more.
      if (hub.devices.size === 0) {
        hub.emptySince ??= now;
        if (now - hub.emptySince >= this.idleStateMs) this.users.delete(userId);
      } else {
        hub.emptySince = null;
      }
    }
  }

  /** Ends every stream (server shutdown). */
  shutdown(): void {
    for (const hub of this.users.values()) {
      for (const device of hub.devices.values()) {
        device.sink?.end();
        device.wake?.();
      }
    }
    this.users.clear();
  }

  /** Tells every connection of a user that their credentials are no longer valid and drops them. */
  revoke(userId: number): void {
    const hub = this.users.get(userId);
    if (!hub) return;
    for (const device of [...hub.devices.values()]) {
      this.emit(device, { name: 'revoked', data: {} });
      device.sink?.end();
      device.wake?.();
    }
    this.users.delete(userId);
  }

  /**
   * Tells one connection its credentials are no longer valid and drops it. Other connections of the same
   * user — e.g. ones opened after a password change — are left alone.
   */
  revokeConnection(userId: number, deviceId: string, connId: number): void {
    const hub = this.users.get(userId);
    const device = hub?.devices.get(deviceId);
    if (!hub || !device || device.connId !== connId) return;
    this.emit(device, { name: 'revoked', data: {} });
    this.removeDevice(hub, device);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private hubFor(userId: number): UserHub {
    let hub = this.users.get(userId);
    if (!hub) {
      hub = {
        devices: new Map(),
        activeDeviceId: null,
        ghost: null,
        state: null,
        queueIds: [],
        queueVersion: 0,
        pending: null,
        recentCommands: [],
        hits: { command: [], state: [], queue: [], rename: [], connect: [] },
        emptySince: null,
      };
      this.users.set(userId, hub);
    }
    return hub;
  }

  private register(
    userId: number,
    info: { deviceId: string; name: string; type: DeviceType },
    transport: 'stream' | 'poll',
    sink?: StreamSink,
  ): Device | 'too_many_devices' | 'rate_limited' {
    const hub = this.hubFor(userId);
    const existing = hub.devices.get(info.deviceId);
    const refuse = (reason: 'too_many_devices' | 'rate_limited') => {
      if (hub.devices.size === 0) this.users.delete(userId);
      return reason;
    };
    if (!existing && hub.devices.size >= this.maxDevices) return refuse('too_many_devices');
    if (!this.allow(hub, 'connect')) return refuse('rate_limited');
    // The same device reconnecting replaces its previous connection.
    if (existing) {
      existing.sink?.end();
      existing.wake?.();
    }

    const device: Device = {
      id: info.deviceId,
      name: info.name,
      type: info.type,
      transport,
      connId: this.nextConnId++,
      sink,
      seq: existing?.seq ?? 0,
      buffer: [],
      lastSeen: this.now(),
    };
    hub.devices.set(device.id, device);
    hub.emptySince = null;
    if (hub.ghost?.id === device.id) hub.ghost = null; // the active device came back

    this.emit(device, { name: 'hello', data: { serverTimeMs: this.now(), you: device.id } });
    this.emit(device, { name: 'snapshot', data: this.snapshot(userId) });
    this.broadcastDevices(hub, device.id);
    return device;
  }

  private removeDevice(hub: UserHub, device: Device): void {
    device.sink?.end();
    device.wake?.();
    hub.devices.delete(device.id);

    if (hub.activeDeviceId === device.id) {
      // Keep it as a "ghost" so controllers can show its name and offer Continue here later.
      const since = this.now();
      hub.ghost = { id: device.id, name: device.name, type: device.type, since, unreachable: false };
      if (hub.state) {
        // The music stopped when the device vanished: freeze the position at that moment.
        hub.state.positionMs = this.positionAt(hub.state, since);
        hub.state.positionAtMs = since;
        hub.state.playing = false;
      }
      this.broadcastState(hub);
    }
    if (hub.pending?.toDeviceId === device.id) hub.pending = null;
    this.broadcastDevices(hub);
    if (hub.devices.size === 0) hub.emptySince = this.now();
  }

  private applyReport(userId: number, hub: UserHub, r: StateReport): void {
    if (r.queueIds) {
      const changed = r.queueIds.length !== hub.queueIds.length || r.queueIds.some((id, i) => id !== hub.queueIds[i]);
      if (changed) {
        hub.queueIds = r.queueIds;
        hub.queueVersion++;
      }
    }
    const index = Math.min(r.index, Math.max(0, hub.queueIds.length - 1));
    const songId = hub.queueIds[index];
    let song: Record<string, unknown> | null = null;
    let durationMs: number | null = null;
    if (songId !== undefined) {
      const resolved = this.resolveSongs(userId, [songId])[0];
      song = resolved?.json ?? null;
      durationMs = resolved?.durationMs ?? null;
    }
    hub.state = {
      playing: r.playing,
      index,
      positionMs: r.positionMs,
      positionAtMs: this.now(),
      repeat: r.repeat,
      shuffle: r.shuffle,
      counted: r.counted,
      volume: r.volume ?? 1,
      queueVersion: hub.queueVersion,
      durationMs,
      song,
    };
  }

  private completeTransfer(hub: UserHub): void {
    const pending = hub.pending;
    hub.pending = null;
    const target = pending ? hub.devices.get(pending.toDeviceId) : undefined;
    if (!pending || !target || !hub.state) return;

    const now = this.now();
    const s = hub.state;
    // A playing state is extrapolated to now; a frozen one (device vanished, or it paused) is used as is.
    const positionMs = s.playing ? this.positionAt(s, now) : s.positionMs;

    hub.activeDeviceId = target.id;
    hub.ghost = null;
    s.playing = false; // nobody is playing until the target reports
    s.positionMs = positionMs;
    s.positionAtMs = now;

    this.emit(target, {
      name: 'load',
      data: {
        queueVersion: hub.queueVersion,
        index: s.index,
        positionMs,
        play: pending.play,
        counted: s.counted,
      },
    });
    this.broadcastDevices(hub);
    this.broadcastState(hub);
  }

  private positionAt(s: StoredState, atMs: number): number {
    const raw = s.playing ? s.positionMs + Math.max(0, atMs - s.positionAtMs) : s.positionMs;
    return s.durationMs != null ? Math.min(raw, s.durationMs) : raw;
  }

  private allow(hub: UserHub, bucket: Bucket): boolean {
    const { max, windowMs } = LIMITS[bucket];
    const now = this.now();
    const hits = hub.hits[bucket];
    while (hits.length && now - hits[0] >= windowMs) hits.shift();
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  }

  private publicState(hub: UserHub): PublicState | null {
    if (!hub.state || !hub.activeDeviceId) return null;
    const s = hub.state;
    return {
      activeDeviceId: hub.activeDeviceId,
      playing: s.playing,
      song: s.song,
      index: s.index,
      queueLength: hub.queueIds.length,
      queueVersion: s.queueVersion,
      positionMs: s.positionMs,
      positionAtMs: s.positionAtMs,
      durationMs: s.durationMs,
      repeat: s.repeat,
      shuffle: s.shuffle,
      counted: s.counted,
      volume: s.volume,
    };
  }

  private deviceList(hub: UserHub): DeviceInfo[] {
    const list: DeviceInfo[] = [...hub.devices.values()].map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      online: true,
      unreachable: false,
      active: hub.activeDeviceId === d.id,
    }));
    if (hub.ghost) {
      list.push({
        id: hub.ghost.id,
        name: hub.ghost.name,
        type: hub.ghost.type,
        online: false,
        unreachable: hub.ghost.unreachable,
        active: hub.activeDeviceId === hub.ghost.id,
      });
    }
    return list;
  }

  private broadcastDevices(hub: UserHub, exceptDeviceId?: string): void {
    const data = { devices: this.deviceList(hub), activeDeviceId: hub.activeDeviceId };
    for (const d of hub.devices.values()) {
      if (d.id !== exceptDeviceId) this.emit(d, { name: 'devices', data });
    }
  }

  private broadcastState(hub: UserHub, exceptDeviceId?: string): void {
    const state = this.publicState(hub);
    if (!state) return;
    for (const d of hub.devices.values()) {
      if (d.id !== exceptDeviceId) this.emit(d, { name: 'state', data: state });
    }
  }

  private emit(device: Device, event: ConnectEvent): void {
    const seq = ++device.seq;
    if (device.transport === 'stream') {
      try {
        device.sink?.send(seq, event);
      } catch {
        // A broken pipe is handled by the stream's own close event.
      }
      return;
    }
    device.buffer.push({ seq, event });
    if (device.buffer.length > POLL_BUFFER) device.buffer.shift();
    device.wake?.();
  }
}
