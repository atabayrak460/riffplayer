// RiffPlayer Connect — the web client's side of multi-device control (docs/CONNECT-DESIGN.md).
//
// While a user is signed in this store keeps a live connection to /api/v1/connect (an SSE stream, with a
// long-poll fallback), mirrors what the *active* device is playing into the normal player store, forwards
// the transport actions as commands while another device is playing, executes commands/handovers when this
// device is the one playing, and reports this device's playback so the others can mirror it.

import { create } from 'zustand';
import { usePlayerStore, remote as remoteRegistry, currentPlayCounted, type RemoteController } from './player';
import { useAuthStore } from './auth';
import { useToastStore } from './toast';
import { useAudioOutputStore } from './audioOutput';
import * as api from '../api/connect';
import { savePlayQueue, getPlayQueue } from '../api/subsonic';
import type { CommandArgs, CommandInstruction, DeviceInfo, DeviceIdentity, LoadInstruction, PublicState, Snapshot } from '../api/connect';
import { SseParser, backoffMs, defaultDeviceName, newId, positionNow } from '../lib/connectProtocol';
import { moveInView, removeFromView, viewIndexOf, type RemoteQueueView } from '../lib/remoteQueue';
import type { Song } from '../api/types';

export type ConnectStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'unavailable';

interface ConnectState {
  status: ConnectStatus;
  transport: 'stream' | 'poll';
  deviceId: string;
  deviceName: string;
  devices: DeviceInfo[];
  activeDeviceId: string | null;
  /** What the active device last reported (also while it is this device). */
  remote: PublicState | null;
  /** The other device's queue, kept fresh while something (the Queue page) is watching it. */
  remoteQueue: RemoteQueueView | null;

  start: () => void;
  stop: () => void;
  transferTo: (deviceId: string) => Promise<void>;
  transferHere: () => Promise<void>;
  renameThisDevice: (name: string) => Promise<void>;
  /** Start keeping `remoteQueue` current; returns the function that stops watching. */
  watchRemoteQueue: () => () => void;
  /** Jump to the song at this index of `remoteQueue` on the playing device. */
  playRemoteQueueItem: (index: number) => void;
  /** Entry point for server events — exposed so tests can drive the store without a network. */
  _handle: (name: string, data: unknown) => void;
}

// ── Tunables ─────────────────────────────────────────────────────────────────

const HELLO_TIMEOUT_MS = 8_000;
const SILENCE_TIMEOUT_MS = 45_000;
const HEALTHY_AFTER_MS = 30_000;
const REPORT_DEBOUNCE_MS = 250;
const SEEK_DEBOUNCE_MS = 150;
const DRIFT_REPORT_MS = 10_000;
const MIRROR_TICK_MS = 250;
const SEEK_JUMP_SECONDS = 1.5;
// Resume where you left off: the queue saved on the server is a window around the current song, written
// when something meaningful changes and otherwise at most every ~10 s while playing.
const RESUME_WINDOW = 500;
const RESUME_LOOKBEHIND = 50;
const RESUME_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
// a little under the 10 s drift report, so that report always saves while playing
const SAVE_EVERY_MS = 9_000;
/** How long mirroring yields after the user starts a track here, while the takeover reaches the server. */
const TAKEOVER_GRACE_MS = 8_000;
/** Fetching the queue of a handover: tries, and the waits between them. */
const LOAD_ATTEMPTS = 3;
const LOAD_RETRY_MS = [500, 1_500];
/** While dragging the volume slider the other device hears it at most this often (plus the final value). */
const VOLUME_SEND_EVERY_MS = 150;
/** After the user moves the volume, state reports about the old value must not move the slider back. */
const VOLUME_HOLD_MS = 1_500;
/** Songs added in quick succession (an album: one "play next" per song) travel as one command. */
const QUEUE_ADD_BATCH_MS = 60;
const QUEUE_ADD_CHUNK = 100;

// ── Identity (persisted) ─────────────────────────────────────────────────────

const ID_KEY = 'riffplayer-device-id';
const NAME_KEY = 'riffplayer-device-name';

function readStorage(storage: () => Storage, key: string): string | null {
  try { return storage().getItem(key); } catch { return null; }
}
function writeStorage(storage: () => Storage, key: string, value: string): void {
  try { storage().setItem(key, value); } catch { /* private mode etc. — fine, it is only a convenience */ }
}

/**
 * Stable per browser (localStorage) plus a part that is new on every page load: two tabs of one browser must
 * be two devices, otherwise they would keep replacing each other's connection. (Not kept in sessionStorage:
 * "Duplicate tab" copies that, which would give both tabs the same id.)
 */
function loadDeviceId(): string {
  let browserId = readStorage(() => localStorage, ID_KEY);
  if (!browserId) {
    browserId = newId();
    writeStorage(() => localStorage, ID_KEY, browserId);
  }
  return `${browserId}-${newId().slice(0, 8)}`.slice(0, 64);
}

function loadDeviceName(): string {
  return readStorage(() => localStorage, NAME_KEY) || defaultDeviceName(typeof navigator !== 'undefined' ? navigator.userAgent : '');
}

// ── Module-level runtime (not reactive) ──────────────────────────────────────

let running = false;
/** Bumped by every start() and stop(): a connection loop that finds it changed belongs to a previous session and ends. */
let generation = 0;
let abort: AbortController | null = null;
let wakeSleep: (() => void) | null = null;
let serverOffsetMs = 0;

let reportTimer: ReturnType<typeof setTimeout> | undefined;
let driftTimer: ReturnType<typeof setInterval> | undefined;
let mirrorTimer: ReturnType<typeof setInterval> | undefined;
let seekTimer: ReturnType<typeof setTimeout> | undefined;
let volumeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingVolume: number | null = null;
let volumeHoldUntil = 0;
let queueAddTimer: ReturnType<typeof setTimeout> | undefined;
let pendingAdds: { next: Song[]; end: Song[] } = { next: [], end: [] };
let queueWatchers = 0;
let fetchingQueue = false;
let unsubscribePlayer: (() => void) | null = null;
let removeWindowListeners: (() => void) | null = null;

/** True while the connect layer itself writes into the player store, so that isn't mistaken for the user. */
let mirroring = false;
/** True while a command from another device is being executed here (it must act locally, never forward). */
let executingLocal = false;

/** While in the future, a track the user just started locally must not be overwritten by the mirror. */
let takeoverUntil = 0;

let lastQueueKey: string | null = null;
let forceQueue = true;
let resumeTried = false;
let lastSave: { key: string; index: number; playing: boolean; at: number } | null = null;
const seenCommands = new Set<string>();
let lastLocal = { time: 0, at: 0 };

const serverNow = () => Date.now() + serverOffsetMs;

// ── Store ────────────────────────────────────────────────────────────────────

export const useConnectStore = create<ConnectState>()((set, get) => {
  const identity = (): DeviceIdentity => ({ deviceId: get().deviceId, name: get().deviceName, type: 'web' });

  function isRemote(): boolean {
    if (executingLocal) return false;
    const { status, activeDeviceId, deviceId } = get();
    return status === 'online' && activeDeviceId !== null && activeDeviceId !== deviceId;
  }

  // ── Mirror: show the remote device's playback through the normal player store ──

  function applyMirror(): void {
    const r = get().remote;
    if (!r || Date.now() < takeoverUntil) return;
    mirroring = true;
    try {
      usePlayerStore.getState().pauseLocal();
      usePlayerStore.setState({
        currentSong: r.song,
        playing: r.playing,
        currentTime: positionNow(r, serverNow()) / 1000,
        duration: (r.durationMs ?? (r.song?.duration ? r.song.duration * 1000 : 0)) / 1000,
        repeatMode: r.repeat,
        shuffle: r.shuffle,
        queue: [],
        queueIndex: -1,
        originalQueue: null,
      });
    } finally {
      mirroring = false;
    }
  }

  function startMirror(): void {
    applyMirror();
    if (!mirrorTimer) mirrorTimer = setInterval(applyMirror, MIRROR_TICK_MS);
  }

  function stopMirror(): void {
    if (mirrorTimer) clearInterval(mirrorTimer);
    mirrorTimer = undefined;
  }

  function syncMirror(): void {
    if (isRemote() && get().remote) {
      startMirror();
    } else {
      takeoverUntil = 0; // this device is the player now (or nobody is): the takeover is settled
      stopMirror();
      if (get().remoteQueue) set({ remoteQueue: null });
    }
  }

  // ── The other device's queue (phase 2) ───────────────────────────────────────

  /** Keeps `remoteQueue` in step with the playing device, but only while someone watches it (it costs a fetch). */
  async function refreshRemoteQueue(retry = true): Promise<void> {
    const r = get().remote;
    if (queueWatchers === 0 || !isRemote() || !r || fetchingQueue) return;
    if (get().remoteQueue?.version === r.queueVersion) return;
    fetchingQueue = true;
    let fetched = false;
    try {
      const q = await api.fetchQueue();
      if (q && isRemote()) {
        fetched = true;
        const positions = q.positions ?? q.songs.map((_, i) => i);
        const current = get().remote;
        const index = current ? viewIndexOf(positions, current.index) : q.index;
        set({ remoteQueue: { version: q.queueVersion, songs: q.songs, positions, index: index >= 0 ? index : q.index } });
      }
    } catch {
      // keep showing what we have; the next state event tries again
    } finally {
      fetchingQueue = false;
    }
    // The queue may have changed again while the request was in flight: look once more, but only once and only
    // after a fetch that worked — never a request loop (a failing server, or a view that is already ahead).
    const now = get().remote;
    const have = get().remoteQueue?.version;
    if (retry && fetched && now && have !== undefined && have < now.queueVersion) void refreshRemoteQueue(false);
  }

  /** The current song's place in the shown queue follows the device's state without a refetch. */
  function followRemoteIndex(): void {
    const view = get().remoteQueue;
    const r = get().remote;
    if (!view || !r || view.version !== r.queueVersion) return;
    const index = viewIndexOf(view.positions, r.index);
    if (index !== view.index) set({ remoteQueue: { ...view, index } });
  }

  // ── Reporting this device's playback ─────────────────────────────────────────

  function shouldReport(): boolean {
    if (get().status !== 'online') return false;
    const p = usePlayerStore.getState();
    if (p.queue.length === 0) return false;
    // While another device plays, only a local "play" (taking over) is worth reporting.
    return isRemote() ? p.playing : true;
  }

  function scheduleReport(delay = REPORT_DEBOUNCE_MS): void {
    if (reportTimer) clearTimeout(reportTimer);
    reportTimer = setTimeout(() => { void sendReport(); }, delay);
  }

  async function sendReport(retried = false): Promise<void> {
    if (!shouldReport()) return;
    const p = usePlayerStore.getState();
    const ids = p.queue.map((s) => s.id);
    const key = ids.join(',');
    const withQueue = forceQueue || key !== lastQueueKey;

    const result = await api.reportState({
      deviceId: get().deviceId,
      ...(withQueue ? { queueIds: ids } : {}),
      index: Math.max(0, p.queueIndex),
      positionMs: Math.round(p.currentTime * 1000),
      playing: p.playing,
      repeat: p.repeatMode,
      shuffle: p.shuffle,
      counted: currentPlayCounted(),
      volume: p.volume,
    });

    switch (result.kind) {
      case 'ok':
        if (withQueue) { lastQueueKey = key; forceQueue = false; }
        break;
      case 'need_queue':
        forceQueue = true;
        if (!retried) await sendReport(true);
        break;
      case 'unavailable':
        get().stop();
        set({ status: 'unavailable' });
        return;
      default:
        break; // not_active / rate_limited / unknown_device / error: nothing useful to do
    }
    saveResume();
  }

  function onLocalChange(s: ReturnType<typeof usePlayerStore.getState>, prev: ReturnType<typeof usePlayerStore.getState>): void {
    if (mirroring) return;
    const now = Date.now();
    // Starting a track here while another device plays is a takeover in progress: until the server
    // confirms it, the mirror must not put the other device's track back over it.
    if (isRemote() && s.currentSong !== prev.currentSong && s.queue.length > 0) takeoverUntil = now + TAKEOVER_GRACE_MS;
    // A jump in the playback position that time alone doesn't explain is a seek, worth telling the others about.
    const expected = lastLocal.time + (prev.playing ? (now - lastLocal.at) / 1000 : 0);
    const jumped = s.currentTime !== prev.currentTime && Math.abs(s.currentTime - expected) > SEEK_JUMP_SECONDS;
    lastLocal = { time: s.currentTime, at: now };

    const changed =
      s.queue !== prev.queue || s.queueIndex !== prev.queueIndex || s.playing !== prev.playing ||
      s.repeatMode !== prev.repeatMode || s.shuffle !== prev.shuffle || s.volume !== prev.volume;
    if ((changed || jumped) && shouldReport()) scheduleReport();
  }

  // ── Resume where you left off ────────────────────────────────────────────────

  /** The part of the queue worth saving: a window around the current song. */
  function resumeWindow(): { ids: string[]; key: string } {
    const p = usePlayerStore.getState();
    const start = Math.max(0, p.queueIndex - RESUME_LOOKBEHIND);
    const ids = p.queue.slice(start, start + RESUME_WINDOW).map((s) => s.id);
    return { ids, key: ids.join(',') };
  }

  /** Remembers the current queue on the server so any device can pick it up later (only the player saves). */
  function saveResume(): void {
    if (isRemote() || get().status !== 'online') return;
    const p = usePlayerStore.getState();
    if (p.queue.length === 0 || p.currentSong === null) return;
    const { ids, key } = resumeWindow();
    const now = Date.now();
    const changed =
      !lastSave || lastSave.key !== key || lastSave.index !== p.queueIndex || lastSave.playing !== p.playing;
    if (!changed && !(p.playing && now - lastSave!.at >= SAVE_EVERY_MS)) return;
    lastSave = { key, index: p.queueIndex, playing: p.playing, at: now };
    savePlayQueue(ids, p.currentSong.id, p.currentTime * 1000).catch(() => {/* best-effort */});
  }

  /** If nobody is playing and this device has nothing loaded, show the last queue again — paused. */
  async function maybeResume(): Promise<void> {
    if (resumeTried) return;
    resumeTried = true;
    try {
      const saved = await getPlayQueue();
      if (!saved) return;
      if (saved.changed && Date.now() - Date.parse(saved.changed) > RESUME_MAX_AGE_MS) return;
      // Something may have started while the request was in flight.
      if (usePlayerStore.getState().queue.length > 0 || get().activeDeviceId !== null) return;
      const index = Math.max(0, saved.songs.findIndex((s) => s.id === saved.current));
      usePlayerStore.getState().restoreQueue(saved.songs, index, saved.positionMs, false, false);
      // What was just restored is already what the server has: don't write it straight back.
      const { key } = resumeWindow();
      lastSave = { key, index, playing: false, at: Date.now() };
    } catch {
      // No saved queue to resume from; nothing else to do.
    }
  }

  // ── Acting on what the server tells us ───────────────────────────────────────

  function execCommand(c: CommandInstruction): void {
    if (seenCommands.has(c.commandId)) return;
    seenCommands.add(c.commandId);
    if (seenCommands.size > 100) seenCommands.delete(seenCommands.values().next().value as string);
    if (c.expiresAtMs < serverNow()) return;

    const p = usePlayerStore.getState();
    executingLocal = true;
    try {
      switch (c.type) {
        case 'play': if (!p.playing) p.togglePlay(); break;
        case 'pause': if (p.playing) p.togglePlay(); break;
        case 'next': p.next(); break;
        case 'previous': p.prev(); break;
        case 'seek': p.seek((c.positionMs ?? 0) / 1000); break;
        case 'volume':
          if (typeof c.volume === 'number' && Number.isFinite(c.volume)) p.setVolume(Math.min(1, Math.max(0, c.volume)));
          break;
        // The queue edits name the song they were aimed at: if the queue changed since the sender looked, the
        // index points at something else now and the edit is dropped rather than applied to the wrong song.
        case 'queue_play':
          if (c.index !== undefined && p.queue[c.index]?.id === c.songId) p.jumpTo(c.index);
          break;
        case 'queue_remove':
          // Removing the song that is playing would stop the music; the other device's UI doesn't offer it.
          if (c.index !== undefined && c.index !== p.queueIndex && p.queue[c.index]?.id === c.songId) p.removeFromQueue(c.index);
          break;
        case 'queue_move':
          if (c.index !== undefined && c.to !== undefined && c.to >= 0 && c.to < p.queue.length && p.queue[c.index]?.id === c.songId) {
            p.reorderQueue(c.index, c.to);
          }
          break;
        case 'queue_add': {
          const songs = (c.songs ?? []).filter((x) => x && typeof x.id === 'string');
          // "Play next" inserts each song right after the current one, so a block goes in back to front.
          if (c.mode === 'next') for (const song of [...songs].reverse()) p.playNext(song);
          else if (c.mode === 'end') for (const song of songs) p.addToQueue(song);
          break;
        }
      }
    } finally {
      executingLocal = false;
    }
  }

  async function handleLoad(load: LoadInstruction): Promise<void> {
    try {
      // By now the server already considers this device the active one, so a queue that fails to arrive
      // would strand the handover: try a few times before giving up.
      let queue: Awaited<ReturnType<typeof api.fetchQueue>> = null;
      for (let attempt = 0; attempt < LOAD_ATTEMPTS && !queue?.songs.length; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, LOAD_RETRY_MS[attempt - 1]));
        queue = await api.fetchQueue();
      }
      if (!queue?.songs.length) {
        useToastStore.getState().show("Couldn't load the queue from the other device");
        return;
      }
      const previous = get().remote;
      usePlayerStore.setState({ repeatMode: previous?.repeat ?? 'off', shuffle: previous?.shuffle ?? false });
      // We are the player now: the next local state report carries the whole queue again.
      forceQueue = true;
      usePlayerStore.getState().restoreQueue(queue.songs, queue.index, load.positionMs, load.play, load.counted);
    } catch {
      // A handover that cannot be loaded (network, malformed queue) leaves things as they were.
    }
  }

  /** Tells the user's other devices where this one's sound comes out (nothing if it is the default speaker). */
  async function reportOutput(): Promise<void> {
    if (get().status !== 'online') return;
    try {
      await api.setDeviceOutput(get().deviceId, useAudioOutputStore.getState().label);
    } catch {
      // purely informational
    }
  }
  useAudioOutputStore.subscribe((state, prev) => {
    if (state.label !== prev.label) void reportOutput();
  });

  function handle(name: string, data: unknown): void {
    switch (name) {
      case 'hello': {
        serverOffsetMs = (data as { serverTimeMs: number }).serverTimeMs - Date.now();
        set({ status: 'online' });
        void reportOutput(); // the others should know where this device's sound goes
        break;
      }
      case 'snapshot': {
        const s = data as Snapshot;
        set({ devices: s.devices, activeDeviceId: s.activeDeviceId, remote: s.state });
        syncMirror();
        void refreshRemoteQueue();
        // (Re)connected: let the server know our queue again (it may have restarted).
        forceQueue = true;
        if (shouldReport()) scheduleReport(0);
        if (s.activeDeviceId === null && usePlayerStore.getState().queue.length === 0) void maybeResume();
        break;
      }
      case 'devices': {
        const d = data as { devices: DeviceInfo[]; activeDeviceId: string | null };
        set({ devices: d.devices, activeDeviceId: d.activeDeviceId });
        syncMirror();
        void refreshRemoteQueue();
        break;
      }
      case 'state': {
        let s = data as PublicState;
        // The user just moved the volume: a report generated before the device heard about it must not drag the slider back.
        const held = get().remote?.volume;
        if (Date.now() < volumeHoldUntil && held !== undefined) s = { ...s, volume: held };
        set({ remote: s, activeDeviceId: s.activeDeviceId });
        syncMirror();
        followRemoteIndex();
        void refreshRemoteQueue();
        break;
      }
      case 'command':
        execCommand(data as CommandInstruction);
        break;
      case 'load':
        void handleLoad(data as LoadInstruction);
        break;
      case 'revoked':
        useAuthStore.getState().logout();
        break;
      case 'error':
        // e.g. too_many_devices: stay quiet, the reconnect loop backs off
        set({ status: 'offline' });
        break;
    }
  }

  // ── Commands this device sends while it is only a remote ─────────────────────

  /** Resolves to whether the command was delivered. */
  async function sendRemoteCommand(type: Parameters<RemoteController['command']>[0] | CommandInstruction['type'], positionMs?: number, args?: CommandArgs): Promise<boolean> {
    // Aimed at the device we believe is playing; the server refuses it if another one has taken over.
    const result = args
      ? await api.sendCommand(get().deviceId, type, positionMs, get().activeDeviceId ?? undefined, args)
      : await api.sendCommand(get().deviceId, type, positionMs, get().activeDeviceId ?? undefined);
    if (result === 'sent') return true;
    const active = get().devices.find((d) => d.id === get().activeDeviceId);
    useToastStore.getState().show(
      result === 'target_changed'
        ? 'Another device just took over — try again'
        : result === 'no_active_device' || result === 'unknown_device'
          ? `${active?.name ?? 'That device'} isn't reachable right now`
          : result === 'rate_limited'
            ? 'Slow down a little'
            : 'Couldn\'t reach the server',
    );
    return false;
  }

  function activeName(): string {
    return get().devices.find((d) => d.id === get().activeDeviceId)?.name ?? 'the other device';
  }

  // Volume: the slider follows the finger at once; the other device hears it at a steady pace, then the final value.
  function sendVolume(): void {
    volumeTimer = undefined;
    if (pendingVolume === null) return;
    const v = pendingVolume;
    pendingVolume = null;
    void sendRemoteCommand('volume', undefined, { volume: v });
    // Keep the cooldown running so a drag doesn't flood the server; a value that arrives meanwhile goes out at its end.
    volumeTimer = setTimeout(sendVolume, VOLUME_SEND_EVERY_MS);
  }

  function setRemoteVolume(v: number): void {
    const volume = Math.min(1, Math.max(0, v));
    const before = get().remote;
    if (before) set({ remote: { ...before, volume } });
    volumeHoldUntil = Date.now() + VOLUME_HOLD_MS;
    pendingVolume = volume;
    if (!volumeTimer) sendVolume();
  }

  // Queue edits: shown at once (the view is updated), then sent; the device's next report replaces the view.
  function queueTarget(index: number): { real: number; songId: string } | null {
    const view = get().remoteQueue;
    const song = view?.songs[index];
    if (!view || !song) return null;
    return { real: view.positions[index], songId: song.id };
  }

  function flushQueueAdds(): void {
    queueAddTimer = undefined;
    const { next, end } = pendingAdds;
    pendingAdds = { next: [], end: [] };
    const name = activeName();
    const toast = useToastStore.getState();

    // A "play next" block goes in back to front (each song is inserted right after the current one), so the
    // calls — which come last song first — are reversed to get the block in listening order.
    const send = async (mode: 'next' | 'end', ordered: Song[], message: string) => {
      if (ordered.length === 0) return;
      const chunks: Song[][] = [];
      for (let i = 0; i < ordered.length; i += QUEUE_ADD_CHUNK) chunks.push(ordered.slice(i, i + QUEUE_ADD_CHUNK));
      // For "next" the first chunk must end up first, i.e. be inserted last.
      const sequence = mode === 'next' ? chunks.reverse() : chunks;
      let delivered = true;
      for (const chunk of sequence) {
        delivered = (await sendRemoteCommand('queue_add', undefined, { mode, songIds: chunk.map((x) => x.id) })) && delivered;
      }
      if (delivered) toast.show(message);
    };
    const count = (n: number) => (n === 1 ? '1 song' : `${n} songs`);
    void send('next', [...next].reverse(), `${count(next.length)} will play next on ${name}`);
    void send('end', end, `Added ${count(end.length)} to the queue on ${name}`);
  }

  function queueAdd(song: Song, mode: 'next' | 'end'): void {
    pendingAdds[mode].push(song);
    if (!queueAddTimer) queueAddTimer = setTimeout(flushQueueAdds, QUEUE_ADD_BATCH_MS);
  }

  const controller: RemoteController = {
    isRemote,
    setVolume: setRemoteVolume,
    volume: () => get().remote?.volume ?? 1,
    queueAdd,
    queueRemove(index) {
      const t = queueTarget(index);
      const view = get().remoteQueue;
      if (!t || !view) return;
      set({ remoteQueue: removeFromView(view, index) });
      void sendRemoteCommand('queue_remove', undefined, { index: t.real, songId: t.songId });
    },
    queueMove(from, to) {
      const t = queueTarget(from);
      const dest = queueTarget(to);
      const view = get().remoteQueue;
      if (!t || !dest || !view) return;
      set({ remoteQueue: moveInView(view, from, to) });
      void sendRemoteCommand('queue_move', undefined, { index: t.real, to: dest.real, songId: t.songId });
    },
    command(type, positionMs) {
      if (type === 'seek') {
        // Dragging the slider fires continuously: send only where it comes to rest.
        if (seekTimer) clearTimeout(seekTimer);
        seekTimer = setTimeout(() => { void sendRemoteCommand('seek', positionMs); }, SEEK_DEBOUNCE_MS);
        return;
      }
      // Flip play/pause at once so the button answers instantly; the real state follows.
      const before = get().remote;
      let optimistic: PublicState | null = null;
      if ((type === 'play' || type === 'pause') && before) {
        optimistic = { ...before, playing: type === 'play', positionMs: positionNow(before, serverNow()), positionAtMs: serverNow() };
        set({ remote: optimistic });
        applyMirror();
      }
      void sendRemoteCommand(type, positionMs).then((delivered) => {
        // Not delivered: put the button back — unless the server has told us something newer in the meantime.
        if (!delivered && optimistic && get().remote === optimistic) {
          set({ remote: before });
          applyMirror();
        }
      });
    },
  };

  // ── Connection loop ──────────────────────────────────────────────────────────

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wakeSleep = () => { clearTimeout(timer); resolve(); };
    });
  }

  async function runStream(ctrl: AbortController): Promise<'ended' | 'silent' | 'unavailable'> {
    const res = await api.openStream(identity(), ctrl.signal);
    if (res.status === 404) return 'unavailable';
    if (!res.ok || !res.body) return 'ended';

    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let gotHello = false;
    let silent = false;
    let lastData = Date.now();
    const helloTimer = setTimeout(() => { if (!gotHello) { silent = true; ctrl.abort(); } }, HELLO_TIMEOUT_MS);
    const watchdog = setInterval(() => {
      if (Date.now() - lastData > SILENCE_TIMEOUT_MS) { silent = true; ctrl.abort(); }
    }, 5_000);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lastData = Date.now();
        for (const item of parser.push(decoder.decode(value, { stream: true }))) {
          if (item.kind !== 'event') continue;
          if (item.name === 'hello') gotHello = true;
          handle(item.name, item.data);
        }
      }
    } catch {
      // aborted or the connection dropped: reported through the return value
    } finally {
      clearTimeout(helloTimer);
      clearInterval(watchdog);
    }
    return silent ? 'silent' : 'ended';
  }

  async function runPoll(ctrl: AbortController): Promise<'ended' | 'unavailable'> {
    let since: number | undefined;
    try {
      while (running && !ctrl.signal.aborted) {
        const r = await api.pollOnce(identity(), since, ctrl.signal);
        if (r.status === 404) return 'unavailable';
        if (r.status !== 200) return 'ended';
        for (const e of r.events) {
          since = e.seq;
          handle(e.event, e.data);
        }
      }
    } catch {
      // aborted or the connection dropped
    }
    return 'ended';
  }

  async function connectionLoop(mine: number): Promise<void> {
    let attempt = 0;
    let silentStreams = 0;
    while (running && mine === generation) {
      const ctrl = new AbortController();
      abort = ctrl;
      if (get().status !== 'online') set({ status: 'connecting' });
      const startedAt = Date.now();

      let outcome: 'ended' | 'silent' | 'unavailable';
      try {
        outcome = get().transport === 'poll' ? await runPoll(ctrl) : await runStream(ctrl);
      } catch {
        outcome = 'ended';
      }
      if (!running || mine !== generation) return; // stopped (and maybe restarted) while we were waiting

      if (outcome === 'unavailable') {
        // An older server without /connect: hide the feature and stop trying.
        get().stop();
        set({ status: 'unavailable' });
        return;
      }

      if (outcome === 'silent') {
        // Nothing (not even the heartbeat) came through: something on the path buffers streams.
        silentStreams++;
        if (silentStreams >= 2) set({ transport: 'poll' });
      } else {
        silentStreams = 0;
      }

      // A connection that lasted a while was healthy: the next failure starts the backoff over at ~1 s.
      if (Date.now() - startedAt >= HEALTHY_AFTER_MS) attempt = 0;
      stopMirror();
      set({ status: 'offline' });
      await sleep(backoffMs(attempt));
      attempt++;
    }
    // (falling out of the loop: stop() was called, or a newer loop took over)
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  return {
    status: 'idle',
    transport: 'stream',
    deviceId: loadDeviceId(),
    deviceName: loadDeviceName(),
    devices: [],
    activeDeviceId: null,
    remote: null,
    remoteQueue: null,

    start: () => {
      if (running) return;
      running = true;
      forceQueue = true;
      lastQueueKey = null;
      resumeTried = false;
      lastSave = null;
      lastLocal = { time: usePlayerStore.getState().currentTime, at: Date.now() };
      set({ status: 'connecting', transport: 'stream' });

      remoteRegistry.current = controller;
      unsubscribePlayer = usePlayerStore.subscribe(onLocalChange);
      driftTimer = setInterval(() => {
        if (get().status === 'online' && !isRemote() && usePlayerStore.getState().playing) void sendReport();
      }, DRIFT_REPORT_MS);

      // Coming back to the tab or regaining network: don't wait out the backoff.
      const wake = () => { if (get().status === 'offline') wakeSleep?.(); };
      const onVisible = () => { if (document.visibilityState === 'visible') wake(); };
      window.addEventListener('online', wake);
      document.addEventListener('visibilitychange', onVisible);
      removeWindowListeners = () => {
        window.removeEventListener('online', wake);
        document.removeEventListener('visibilitychange', onVisible);
      };

      void connectionLoop(++generation);
    },

    stop: () => {
      running = false;
      generation++;
      abort?.abort();
      abort = null;
      wakeSleep?.();
      wakeSleep = null;
      if (reportTimer) clearTimeout(reportTimer);
      if (driftTimer) clearInterval(driftTimer);
      if (seekTimer) clearTimeout(seekTimer);
      if (volumeTimer) clearTimeout(volumeTimer);
      if (queueAddTimer) clearTimeout(queueAddTimer);
      reportTimer = driftTimer = seekTimer = volumeTimer = queueAddTimer = undefined;
      pendingVolume = null;
      volumeHoldUntil = 0;
      pendingAdds = { next: [], end: [] };
      takeoverUntil = 0;
      stopMirror();
      unsubscribePlayer?.();
      unsubscribePlayer = null;
      removeWindowListeners?.();
      removeWindowListeners = null;
      if (remoteRegistry.current === controller) remoteRegistry.current = null;
      set({ status: 'idle', devices: [], activeDeviceId: null, remote: null, remoteQueue: null });
    },

    transferTo: async (toDeviceId) => {
      const result = await api.transferPlayback(get().deviceId, toDeviceId, true);
      const messages: Partial<Record<typeof result, string>> = {
        target_offline: 'That device is offline',
        nothing_playing: 'Nothing has been played yet — start something first',
        rate_limited: 'Slow down a little',
        error: 'Couldn\'t reach the server',
      };
      const message = messages[result];
      if (message) useToastStore.getState().show(message);
    },

    transferHere: async () => get().transferTo(get().deviceId),

    renameThisDevice: async (name) => {
      const clean = name.trim().slice(0, 40);
      if (!clean) return;
      set({ deviceName: clean });
      writeStorage(() => localStorage, NAME_KEY, clean);
      if (get().status === 'online') await api.renameDevice(get().deviceId, clean);
    },

    watchRemoteQueue: () => {
      queueWatchers++;
      void refreshRemoteQueue();
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        queueWatchers = Math.max(0, queueWatchers - 1);
      };
    },

    playRemoteQueueItem: (index) => {
      const t = queueTarget(index);
      if (t) void sendRemoteCommand('queue_play', undefined, { index: t.real, songId: t.songId });
    },

    _handle: handle,
  };
});
