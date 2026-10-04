import { randomBytes, timingSafeEqual } from 'crypto';

// Linking a TV (or any device with no keyboard worth the name) without typing a password on it:
//   1. the TV asks for a code (device-code) and shows the short USER code on its screen;
//   2. the user types that code in the web app or on their phone, where they are already signed in
//      (device-approve) — that is the only place a password is ever involved;
//   3. the TV, polling with its secret DEVICE code (device-token), receives a session token and an
//      API key (a revocable credential that is NOT the account password).
// Pending pairings live in memory only and expire after ten minutes; a server restart just means
// the TV asks for a new code.

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_S = 3;
const MAX_PENDING = 200;
// No 0/O/1/I/L — people read these off a TV across the room.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface Approval {
  userId: number;
}

interface Pending {
  userCode: string;
  deviceName: string;
  expiresAt: number;
  approval: Approval | null;
}

const pending = new Map<string, Pending>(); // keyed by the secret device code

const normalise = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

function newUserCode(): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function sweep(now: number): void {
  for (const [key, p] of pending) if (p.expiresAt <= now) pending.delete(key);
}

export function startPairing(deviceName: string, now = Date.now()): { deviceCode: string; userCode: string; expiresIn: number; interval: number } {
  sweep(now);
  // A flood of requests can't grow memory without bound: the oldest pairing makes way.
  if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value as string);
  const deviceCode = randomBytes(24).toString('hex');
  let userCode = newUserCode();
  while ([...pending.values()].some((p) => p.userCode === userCode)) userCode = newUserCode();
  pending.set(deviceCode, { userCode, deviceName, expiresAt: now + PAIRING_TTL_MS, approval: null });
  return { deviceCode, userCode, expiresIn: PAIRING_TTL_MS / 1000, interval: POLL_INTERVAL_S };
}

/** The signed-in user approves the code shown on the TV. Returns the TV's name, or null for an unknown / expired / used code. */
export function approvePairing(userCode: string, approval: Approval, now = Date.now()): { deviceName: string } | null {
  sweep(now);
  const wanted = normalise(userCode);
  for (const p of pending.values()) {
    if (normalise(p.userCode) === wanted && !p.approval) {
      p.approval = approval;
      return { deviceName: p.deviceName };
    }
  }
  return null;
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'expired' } // unknown code, expired, or already collected
  | { status: 'approved'; approval: Approval; deviceName: string };

/** The TV asks whether its code was approved. An approval can be collected exactly once. */
export function pollPairing(deviceCode: string, now = Date.now()): PollResult {
  sweep(now);
  // Constant-time comparison: the device code is a secret.
  let found: [string, Pending] | null = null;
  const given = Buffer.from(deviceCode);
  for (const entry of pending) {
    const key = Buffer.from(entry[0]);
    if (key.length === given.length && timingSafeEqual(key, given)) found = entry;
  }
  if (!found) return { status: 'expired' };
  const [key, p] = found;
  if (!p.approval) return { status: 'pending' };
  pending.delete(key);
  return { status: 'approved', approval: p.approval, deviceName: p.deviceName };
}

/** Test hook. */
export function resetPairingForTests(): void {
  pending.clear();
}
