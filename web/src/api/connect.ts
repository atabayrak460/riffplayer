// RiffPlayer Connect API client — see docs/CONNECT-DESIGN.md. Thin typed wrappers around
// /api/v1/connect/*; every function maps HTTP outcomes to a small result value instead of throwing,
// so the store can react to "need_queue" / "no_active_device" etc. without parsing errors.

import { apiFetch } from './subsonic';
import { newId } from '../lib/connectProtocol';
import type { Song } from './types';

export type DeviceType = 'web' | 'android' | 'desktop';
export type RepeatMode = 'off' | 'all' | 'one';
export type CommandType =
  | 'play' | 'pause' | 'next' | 'previous' | 'seek'
  | 'volume' | 'queue_play' | 'queue_remove' | 'queue_move' | 'queue_add';
export type QueueAddMode = 'next' | 'end';

/** What a sender attaches to a command; which fields apply depends on the type (see the server's hub). */
export interface CommandArgs {
  positionMs?: number;
  /** 0..1 */
  volume?: number;
  /** queue_play / queue_remove / queue_move: the real queue position of the song. */
  index?: number;
  /** queue_move: where to put it. */
  to?: number;
  /** The song the sender saw at `index` — the playing device ignores the command if the queue changed under it. */
  songId?: string;
  /** queue_add (sent as ids; the playing device receives the resolved `songs`). */
  songIds?: string[];
  mode?: QueueAddMode;
}

export interface DeviceInfo {
  id: string;
  name: string;
  type: DeviceType;
  online: boolean;
  unreachable: boolean;
  active: boolean;
}

export interface PublicState {
  activeDeviceId: string;
  playing: boolean;
  song: Song | null;
  index: number;
  queueLength: number;
  queueVersion: number;
  positionMs: number;
  /** Server clock at which `positionMs` was true. */
  positionAtMs: number;
  durationMs: number | null;
  repeat: RepeatMode;
  shuffle: boolean;
  counted: boolean;
  /** The playing device's own player volume, 0..1 (absent from servers older than phase 2). */
  volume?: number;
}

export interface Snapshot {
  devices: DeviceInfo[];
  activeDeviceId: string | null;
  state: PublicState | null;
}

export interface LoadInstruction {
  queueVersion: number;
  index: number;
  positionMs: number;
  play: boolean;
  counted: boolean;
}

export interface CommandInstruction extends Omit<CommandArgs, 'songIds'> {
  commandId: string;
  type: CommandType;
  expiresAtMs: number;
  /** queue_add: the songs to queue, already resolved by the server. */
  songs?: Song[];
}

export interface DeviceIdentity {
  deviceId: string;
  name: string;
  type: DeviceType;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function identityQuery({ deviceId, name, type }: DeviceIdentity): string {
  return `deviceId=${encodeURIComponent(deviceId)}&name=${encodeURIComponent(name)}&type=${type}`;
}

async function post(path: string, body: unknown, method = 'POST'): Promise<Response | null> {
  try {
    return await apiFetch(`connect/${path}`, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
  } catch {
    return null; // network failure
  }
}

async function errorCode(res: Response): Promise<string | undefined> {
  return ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
}

// ── Streams ──────────────────────────────────────────────────────────────────

export function openStream(identity: DeviceIdentity, signal: AbortSignal): Promise<Response> {
  return apiFetch(`connect/stream?${identityQuery(identity)}`, {
    signal,
    headers: { Accept: 'text/event-stream' },
  });
}

export interface PolledEvent { seq: number; event: string; data: unknown }

/** One long-poll round trip. `since` is undefined on the first call (which registers the device). */
export async function pollOnce(
  identity: DeviceIdentity,
  since: number | undefined,
  signal: AbortSignal,
): Promise<{ status: number; events: PolledEvent[] }> {
  const query = identityQuery(identity) + (since !== undefined ? `&since=${since}` : '');
  const res = await apiFetch(`connect/poll?${query}`, { signal });
  if (!res.ok) return { status: res.status, events: [] };
  const body = (await res.json()) as { events: PolledEvent[] };
  return { status: res.status, events: body.events };
}

// ── State, commands, transfer ────────────────────────────────────────────────

export interface StateReport {
  deviceId: string;
  queueIds?: string[];
  index: number;
  positionMs: number;
  playing: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  counted: boolean;
  volume?: number;
}

export type ReportResult =
  | { kind: 'ok'; takeover: boolean }
  | { kind: 'not_active' }
  | { kind: 'need_queue' }
  | { kind: 'unknown_device' }
  | { kind: 'rate_limited' }
  | { kind: 'unavailable' }
  | { kind: 'error' };

export async function reportState(report: StateReport): Promise<ReportResult> {
  const res = await post('state', report);
  if (!res) return { kind: 'error' };
  if (res.status === 404) return { kind: 'unavailable' };
  if (res.status === 429) return { kind: 'rate_limited' };
  if (res.status === 409) {
    const code = await errorCode(res);
    return code === 'need_queue' ? { kind: 'need_queue' } : { kind: 'unknown_device' };
  }
  if (!res.ok) return { kind: 'error' };
  const body = (await res.json()) as { accepted: boolean; takeover?: boolean };
  return body.accepted ? { kind: 'ok', takeover: body.takeover === true } : { kind: 'not_active' };
}

export type CommandResult =
  | 'sent' | 'no_active_device' | 'self' | 'target_changed' | 'unknown_device' | 'rate_limited' | 'unavailable' | 'error';

/**
 * `targetDeviceId` is the device the sender saw playing; the server refuses the command ("target_changed")
 * if another device has taken over since, rather than letting it land on the wrong one.
 */
export async function sendCommand(
  deviceId: string,
  type: CommandType,
  positionMs?: number,
  targetDeviceId?: string,
  args?: CommandArgs,
): Promise<CommandResult> {
  const res = await post('command', {
    deviceId,
    commandId: newId(),
    type,
    ...args,
    ...(positionMs !== undefined ? { positionMs: Math.round(positionMs) } : {}),
    ...(targetDeviceId !== undefined ? { targetDeviceId } : {}),
  });
  if (!res) return 'error';
  if (res.status === 404) return 'unavailable';
  if (res.status === 429) return 'rate_limited';
  if (res.status === 409) {
    const code = await errorCode(res);
    return code === 'no_active_device' || code === 'self' || code === 'target_changed' ? code : 'unknown_device';
  }
  return res.ok ? 'sent' : 'error';
}

export type TransferResult =
  | 'ok' | 'pending' | 'noop' | 'target_offline' | 'nothing_playing'
  | 'unknown_device' | 'rate_limited' | 'unavailable' | 'error';

export async function transferPlayback(deviceId: string, toDeviceId: string, play = true): Promise<TransferResult> {
  const res = await post('transfer', { deviceId, toDeviceId, play });
  if (!res) return 'error';
  if (res.status === 429) return 'rate_limited';
  if (res.status === 404) {
    return (await errorCode(res)) === 'target_offline' ? 'target_offline' : 'unavailable';
  }
  if (res.status === 409) {
    return (await errorCode(res)) === 'nothing_playing' ? 'nothing_playing' : 'unknown_device';
  }
  if (!res.ok) return 'error';
  const status = ((await res.json()) as { status: 'done' | 'pending' | 'noop' }).status;
  return status === 'done' ? 'ok' : status;
}

export async function renameDevice(deviceId: string, name: string): Promise<boolean> {
  const res = await post('device', { deviceId, name }, 'PATCH');
  return !!res?.ok;
}

export interface RemoteQueueResponse {
  queueVersion: number;
  index: number;
  songs: Song[];
  /** Real queue position of each song (the library may have dropped some). Absent from older servers. */
  positions?: number[];
}

export async function fetchQueue(): Promise<RemoteQueueResponse | null> {
  try {
    const res = await apiFetch('connect/queue');
    if (!res.ok) return null;
    return (await res.json()) as RemoteQueueResponse;
  } catch {
    return null;
  }
}
