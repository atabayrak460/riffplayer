// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { Song } from '../api/types';
import type { DeviceInfo, PublicState } from '../api/connect';

// player.ts builds its <audio> element at import time; a tiny fake keeps jsdom from logging
// "not implemented" for every play()/pause() and lets tests see whether audio was silenced.
class FakeAudio {
  static instance: FakeAudio;
  preload = ''; src = ''; volume = 1; paused = true; currentTime = 0; duration = 0;
  constructor() { FakeAudio.instance = this; }
  addEventListener() {}
  removeEventListener() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
}
vi.stubGlobal('Audio', FakeAudio);

vi.mock('../api/connect', () => ({
  openStream: vi.fn(),
  pollOnce: vi.fn(),
  reportState: vi.fn(),
  sendCommand: vi.fn(),
  transferPlayback: vi.fn(),
  renameDevice: vi.fn(),
  fetchQueue: vi.fn(),
}));
vi.mock('../lib/offlineDb', () => ({ getTrackAudioBlob: vi.fn() }));
vi.mock('../api/subsonic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/subsonic')>()),
  scrobble: vi.fn().mockResolvedValue(undefined),
  savePlayQueue: vi.fn().mockResolvedValue(undefined),
  getPlayQueue: vi.fn().mockResolvedValue(null),
}));

const api = await import('../api/connect');
const subsonic = await import('../api/subsonic');
const { useConnectStore } = await import('./connect');
const { usePlayerStore, remote: remoteRegistry } = await import('./player');
const { useAuthStore } = await import('./auth');
const { useToastStore } = await import('./toast');

const ME = 'me-device-0001';
const OTHER = 'other-device-01';

const song = (id: string, extra: Partial<Song> = {}): Song =>
  ({ id, title: `Song ${id}`, artist: 'Artist', album: 'Album', albumId: 'al1', artistId: 'ar1', duration: 200, ...extra }) as Song;

const device = (id: string, over: Partial<DeviceInfo> = {}): DeviceInfo =>
  ({ id, name: id === ME ? 'My PC' : 'Phone', type: 'web', online: true, unreachable: false, active: false, ...over });

function remoteState(over: Partial<PublicState> = {}): PublicState {
  return {
    activeDeviceId: OTHER, playing: true, song: song('r1', { title: 'Remote Song' }), index: 0, queueLength: 3,
    queueVersion: 1, positionMs: 10_000, positionAtMs: Date.now(), durationMs: 200_000, repeat: 'off', shuffle: false,
    counted: false, ...over,
  };
}

const handle = (name: string, data: unknown) => useConnectStore.getState()._handle(name, data);
const connectState = () => useConnectStore.getState();

/** Snapshot in which `OTHER` is the one playing. */
function otherIsPlaying(over: Partial<PublicState> = {}) {
  handle('snapshot', {
    devices: [device(ME), device(OTHER, { active: true })],
    activeDeviceId: OTHER,
    state: remoteState(over),
  });
}

function startOnline() {
  vi.mocked(api.openStream).mockReturnValue(new Promise(() => {}));
  connectState().start();
  useConnectStore.setState({ status: 'online' });
}

const playerBase = {
  queue: [], queueIndex: -1, currentSong: null, playing: false, currentTime: 0, duration: 0,
  repeatMode: 'off' as const, shuffle: false, originalQueue: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  usePlayerStore.setState({ ...playerBase });
  useConnectStore.setState({
    status: 'online', transport: 'stream', deviceId: ME, deviceName: 'My PC',
    devices: [], activeDeviceId: null, remote: null, remoteQueue: null,
  });
  useToastStore.setState({ message: null });
  vi.mocked(api.reportState).mockResolvedValue({ kind: 'ok', takeover: false });
  vi.mocked(api.sendCommand).mockResolvedValue('sent');
  vi.mocked(api.transferPlayback).mockResolvedValue('ok');
  vi.mocked(api.renameDevice).mockResolvedValue(true);
  vi.mocked(api.fetchQueue).mockResolvedValue(null);
  vi.mocked(subsonic.savePlayQueue).mockResolvedValue(undefined);
  vi.mocked(subsonic.getPlayQueue).mockResolvedValue(null);
  FakeAudio.instance.paused = true;
});

afterEach(() => {
  connectState().stop();
  vi.useRealTimers();
});

// ── Events → state ───────────────────────────────────────────────────────────

describe('events', () => {
  it('hello marks the device online', () => {
    useConnectStore.setState({ status: 'connecting' });
    handle('hello', { serverTimeMs: Date.now(), you: ME });
    expect(connectState().status).toBe('online');
  });

  it('snapshot stores the devices, the active device and the remote state', () => {
    otherIsPlaying();

    expect(connectState().devices.map((d) => d.id)).toEqual([ME, OTHER]);
    expect(connectState().activeDeviceId).toBe(OTHER);
    expect(connectState().remote?.song?.title).toBe('Remote Song');
  });

  it('devices and state events update their parts', () => {
    otherIsPlaying();
    handle('devices', { devices: [device(ME), device(OTHER, { name: 'Renamed', active: true })], activeDeviceId: OTHER });
    expect(connectState().devices[1].name).toBe('Renamed');

    handle('state', remoteState({ index: 2, positionMs: 50_000 }));
    expect(connectState().remote?.index).toBe(2);
  });

  it('revoked signs the user out', () => {
    const logout = vi.fn();
    useAuthStore.setState({ logout });
    handle('revoked', {});
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('a server error event (e.g. too many devices) marks the connection offline', () => {
    handle('error', { error: 'too_many_devices' });
    expect(connectState().status).toBe('offline');
  });

  it('ignores event names it does not know', () => {
    expect(() => handle('from-the-future', { a: 1 })).not.toThrow();
  });
});

// ── Mirror mode ──────────────────────────────────────────────────────────────

describe('mirror mode', () => {
  it('shows what the other device plays through the normal player store and silences local audio', () => {
    FakeAudio.instance.paused = false;
    usePlayerStore.setState({ queue: [song('local')], queueIndex: 0, currentSong: song('local') });

    otherIsPlaying({ repeat: 'all', shuffle: true });

    const p = usePlayerStore.getState();
    expect(p.currentSong?.title).toBe('Remote Song');
    expect(p.playing).toBe(true);
    expect(p.currentTime).toBeCloseTo(10, 0);
    expect(p.duration).toBe(200);
    expect(p.repeatMode).toBe('all');
    expect(p.shuffle).toBe(true);
    expect(p.queue).toEqual([]);
    expect(p.queueIndex).toBe(-1);
    expect(FakeAudio.instance.paused).toBe(true);
  });

  it('keeps the position moving while the other device plays, and not while it is paused', async () => {
    otherIsPlaying({ positionMs: 10_000, positionAtMs: Date.now() });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(usePlayerStore.getState().currentTime).toBeCloseTo(13, 0);

    handle('state', remoteState({ playing: false, positionMs: 13_000, positionAtMs: Date.now() }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(usePlayerStore.getState().currentTime).toBeCloseTo(13, 0);
    expect(usePlayerStore.getState().playing).toBe(false);
  });

  it('does not run past the end of the track', async () => {
    otherIsPlaying({ positionMs: 199_000, positionAtMs: Date.now() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(usePlayerStore.getState().currentTime).toBe(200);
  });

  it('falls back to the song\'s own duration when the report has none', () => {
    otherIsPlaying({ durationMs: null, song: song('r1', { duration: 321 }) });
    expect(usePlayerStore.getState().duration).toBe(321);
  });

  it('follows new state events from the other device', () => {
    otherIsPlaying();
    handle('state', remoteState({ song: song('r2', { title: 'Next One' }), index: 1 }));
    expect(usePlayerStore.getState().currentSong?.title).toBe('Next One');
  });

  it('stops mirroring once this device is the one playing', async () => {
    otherIsPlaying();
    handle('devices', { devices: [device(ME, { active: true }), device(OTHER)], activeDeviceId: ME });

    usePlayerStore.setState({ currentTime: 77 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(usePlayerStore.getState().currentTime).toBe(77);
  });

  it('stops mirroring when the connection drops (the local controls are the only ones that can work)', async () => {
    startOnline();
    otherIsPlaying();
    useConnectStore.setState({ status: 'offline' });
    handle('devices', { devices: [device(ME), device(OTHER, { active: true })], activeDeviceId: OTHER });

    usePlayerStore.setState({ currentTime: 55 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(usePlayerStore.getState().currentTime).toBe(55);
  });

  it('pauses local audio when another device takes over from this one', () => {
    useConnectStore.setState({ activeDeviceId: ME });
    FakeAudio.instance.paused = false;

    handle('devices', { devices: [device(ME), device(OTHER, { active: true })], activeDeviceId: OTHER });
    handle('state', remoteState());

    expect(FakeAudio.instance.paused).toBe(true);
  });
});

// ── Transport actions while only a remote ────────────────────────────────────

describe('controlling the other device', () => {
  beforeEach(() => {
    startOnline();
    otherIsPlaying();
  });

  it('pause/play go to the other device, and the button flips at once', async () => {
    usePlayerStore.getState().togglePlay();
    await vi.advanceTimersByTimeAsync(0);

    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'pause', undefined, OTHER);
    expect(usePlayerStore.getState().playing).toBe(false);
    expect(connectState().remote?.playing).toBe(false);

    usePlayerStore.getState().togglePlay();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sendCommand).toHaveBeenLastCalledWith(ME, 'play', undefined, OTHER);
    expect(usePlayerStore.getState().playing).toBe(true);
  });

  it('puts the play/pause button back when the command could not be delivered', async () => {
    vi.mocked(api.sendCommand).mockResolvedValue('target_changed');

    usePlayerStore.getState().togglePlay(); // optimistic pause
    expect(usePlayerStore.getState().playing).toBe(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(usePlayerStore.getState().playing).toBe(true);
    expect(connectState().remote?.playing).toBe(true);
  });

  it('does not undo a newer state that arrived while the command was in flight', async () => {
    let finish!: (v: 'error') => void;
    vi.mocked(api.sendCommand).mockReturnValue(new Promise((r) => { finish = r as never; }));

    usePlayerStore.getState().togglePlay(); // optimistic pause
    handle('state', remoteState({ playing: false, positionMs: 20_000, positionAtMs: Date.now() })); // the server's own news
    finish('error');
    await vi.advanceTimersByTimeAsync(0);

    expect(connectState().remote?.positionMs).toBe(20_000); // the server's state, not the pre-click one
  });

  it('keeps the shown position steady across an optimistic pause', async () => {
    await vi.advanceTimersByTimeAsync(4_000); // 4 s of the remote song have passed
    usePlayerStore.getState().togglePlay();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(usePlayerStore.getState().currentTime).toBeCloseTo(14, 0);
  });

  it('next and previous go to the other device', async () => {
    usePlayerStore.getState().next();
    usePlayerStore.getState().prev();
    await vi.advanceTimersByTimeAsync(0);

    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'next', undefined, OTHER);
    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'previous', undefined, OTHER);
  });

  it('a slider drag sends only the position where it comes to rest', async () => {
    const seek = usePlayerStore.getState().seek;
    seek(30);
    await vi.advanceTimersByTimeAsync(50);
    seek(60);
    await vi.advanceTimersByTimeAsync(50);
    seek(90);
    expect(api.sendCommand).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);

    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'seek', 90_000, OTHER);
  });

  it('names the device it believes is playing in every command', async () => {
    usePlayerStore.getState().next();
    usePlayerStore.getState().togglePlay();
    await vi.advanceTimersByTimeAsync(0);

    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'next', undefined, OTHER);
    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'pause', undefined, OTHER);

    usePlayerStore.getState().seek(30);
    await vi.advanceTimersByTimeAsync(200);
    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'seek', 30_000, OTHER);
  });

  it('when another device has taken over since, says so instead of acting on the new one', async () => {
    vi.mocked(api.sendCommand).mockResolvedValue('target_changed');
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(0);

    expect(useToastStore.getState().message).toBe('Another device just took over — try again');
  });

  it('says so when the other device cannot be reached', async () => {
    vi.mocked(api.sendCommand).mockResolvedValue('no_active_device');
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(0);

    expect(useToastStore.getState().message).toBe("Phone isn't reachable right now");
  });

  it('says so when the server cannot be reached', async () => {
    vi.mocked(api.sendCommand).mockResolvedValue('error');
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(0);

    expect(useToastStore.getState().message).toBe("Couldn't reach the server");
  });

  it('acts locally again when this device is the one playing', async () => {
    handle('devices', { devices: [device(ME, { active: true }), device(OTHER)], activeDeviceId: ME });
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 0, currentSong: song('a') });

    usePlayerStore.getState().seek(5);
    await vi.advanceTimersByTimeAsync(500);

    expect(api.sendCommand).not.toHaveBeenCalled();
    expect(FakeAudio.instance.currentTime).toBe(5);
  });

  it('acts locally while the connection is down', async () => {
    useConnectStore.setState({ status: 'offline' });
    usePlayerStore.getState().next();
    await vi.advanceTimersByTimeAsync(0);

    expect(api.sendCommand).not.toHaveBeenCalled();
  });
});

// ── Commands executed here ───────────────────────────────────────────────────

describe('commands from another device', () => {
  const cmd = (type: string, over: Record<string, unknown> = {}) => ({
    commandId: `c-${Math.random()}`, type, expiresAtMs: Date.now() + 5_000, ...over,
  });
  let actions: {
    next: Mock<() => void>; prev: Mock<() => void>; seek: Mock<(s: number) => void>; togglePlay: Mock<() => void>;
  };

  beforeEach(() => {
    startOnline();
    actions = { next: vi.fn<() => void>(), prev: vi.fn<() => void>(), seek: vi.fn<(s: number) => void>(), togglePlay: vi.fn<() => void>() };
    usePlayerStore.setState(actions);
  });

  it('next, previous and seek are executed on the local player', () => {
    handle('command', cmd('next'));
    handle('command', cmd('previous'));
    handle('command', cmd('seek', { positionMs: 42_000 }));

    expect(actions.next).toHaveBeenCalledTimes(1);
    expect(actions.prev).toHaveBeenCalledTimes(1);
    expect(actions.seek).toHaveBeenCalledWith(42);
  });

  it('play only starts a paused player and pause only stops a playing one', () => {
    usePlayerStore.setState({ playing: true });
    handle('command', cmd('play'));
    expect(actions.togglePlay).not.toHaveBeenCalled();
    handle('command', cmd('pause'));
    expect(actions.togglePlay).toHaveBeenCalledTimes(1);

    usePlayerStore.setState({ playing: false });
    handle('command', cmd('pause'));
    expect(actions.togglePlay).toHaveBeenCalledTimes(1);
    handle('command', cmd('play'));
    expect(actions.togglePlay).toHaveBeenCalledTimes(2);
  });

  it('runs a command once even if it is delivered twice', () => {
    const c = cmd('next');
    handle('command', c);
    handle('command', c);
    expect(actions.next).toHaveBeenCalledTimes(1);
  });

  it('ignores a command that has expired', () => {
    handle('command', cmd('next', { expiresAtMs: Date.now() - 1 }));
    expect(actions.next).not.toHaveBeenCalled();
  });

  it('never forwards a command back out, even if this device already looks like a remote', () => {
    otherIsPlaying();
    let seenRemote: boolean | undefined;
    actions.next.mockImplementation(() => { seenRemote = remoteRegistry.current?.isRemote(); });

    handle('command', cmd('next'));

    expect(seenRemote).toBe(false);
    expect(remoteRegistry.current?.isRemote()).toBe(true); // and back to normal afterwards
  });
});

// ── Receiving a handover ─────────────────────────────────────────────────────

describe('load (handover to this device)', () => {
  const load = { queueVersion: 2, index: 1, positionMs: 83_000, play: true, counted: true };

  it('fetches the queue and restores it at the given position, keeping the other device\'s repeat/shuffle', async () => {
    const restoreQueue = vi.fn();
    usePlayerStore.setState({ restoreQueue });
    otherIsPlaying({ repeat: 'all', shuffle: true });
    vi.mocked(api.fetchQueue).mockResolvedValue({ queueVersion: 2, index: 1, songs: [song('a'), song('b'), song('c')] });

    handle('load', load);
    await vi.advanceTimersByTimeAsync(0);

    expect(restoreQueue).toHaveBeenCalledWith(expect.any(Array), 1, 83_000, true, true);
    expect(restoreQueue.mock.calls[0][0].map((s: Song) => s.id)).toEqual(['a', 'b', 'c']);
    expect(usePlayerStore.getState().repeatMode).toBe('all');
    expect(usePlayerStore.getState().shuffle).toBe(true);
  });

  it('retries a queue that could not be fetched at first (the device is already the active one by then)', async () => {
    const restoreQueue = vi.fn();
    usePlayerStore.setState({ restoreQueue });
    vi.mocked(api.fetchQueue)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ queueVersion: 2, index: 0, songs: [song('a')] });

    handle('load', load);
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreQueue).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);

    expect(restoreQueue).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().message).toBeNull();
  });

  it('tells the user when the queue cannot be fetched after several tries', async () => {
    const restoreQueue = vi.fn();
    usePlayerStore.setState({ restoreQueue });
    vi.mocked(api.fetchQueue).mockResolvedValue(null);

    handle('load', load);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(api.fetchQueue).toHaveBeenCalledTimes(3);
    expect(restoreQueue).not.toHaveBeenCalled();
    expect(useToastStore.getState().message).toBe("Couldn't load the queue from the other device");
  });

  it('survives a handover whose queue cannot be loaded', async () => {
    const restoreQueue = vi.fn();
    usePlayerStore.setState({ restoreQueue });
    vi.mocked(api.fetchQueue).mockRejectedValue(new TypeError('Failed to fetch'));

    expect(() => handle('load', load)).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);

    expect(restoreQueue).not.toHaveBeenCalled();
  });

  it('does nothing when the server has no queue to give', async () => {
    const restoreQueue = vi.fn();
    usePlayerStore.setState({ restoreQueue });

    handle('load', load);
    await vi.advanceTimersByTimeAsync(0);

    expect(restoreQueue).not.toHaveBeenCalled();
  });

  it('plays a paused handover without starting it', async () => {
    const restoreQueue = vi.fn();
    usePlayerStore.setState({ restoreQueue });
    vi.mocked(api.fetchQueue).mockResolvedValue({ queueVersion: 2, index: 0, songs: [song('a')] });

    handle('load', { ...load, play: false, counted: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(restoreQueue).toHaveBeenCalledWith(expect.any(Array), 0, 83_000, false, false);
  });
});

// ── Reporting this device's playback ─────────────────────────────────────────

describe('reporting local playback', () => {
  const play = (over: Record<string, unknown> = {}) =>
    usePlayerStore.setState({
      queue: [song('a'), song('b')], queueIndex: 0, currentSong: song('a'), playing: true, currentTime: 12.3,
      ...over,
    });

  beforeEach(() => {
    startOnline();
  });

  it('reports what is playing, with the whole queue the first time', async () => {
    play();
    await vi.advanceTimersByTimeAsync(250);

    expect(api.reportState).toHaveBeenCalledTimes(1);
    expect(api.reportState).toHaveBeenCalledWith({
      deviceId: ME, queueIds: ['a', 'b'], index: 0, positionMs: 12_300, playing: true,
      repeat: 'off', shuffle: false, counted: false, volume: 1,
    });
  });

  it('leaves the queue out of later reports until it changes', async () => {
    play();
    await vi.advanceTimersByTimeAsync(250);
    usePlayerStore.setState({ playing: false });
    await vi.advanceTimersByTimeAsync(250);

    const second = vi.mocked(api.reportState).mock.calls[1][0];
    expect(second.playing).toBe(false);
    expect('queueIds' in second).toBe(false);

    usePlayerStore.setState({ queue: [song('a'), song('b'), song('c')] });
    await vi.advanceTimersByTimeAsync(250);
    expect(vi.mocked(api.reportState).mock.calls[2][0].queueIds).toEqual(['a', 'b', 'c']);
  });

  it('coalesces a burst of changes into one report', async () => {
    play();
    usePlayerStore.setState({ queueIndex: 1 });
    usePlayerStore.setState({ repeatMode: 'all' });
    await vi.advanceTimersByTimeAsync(250);

    expect(api.reportState).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.reportState).mock.calls[0][0]).toMatchObject({ index: 1, repeat: 'all' });
  });

  it('resends once with the queue when the server asks for it, and does not loop', async () => {
    play();
    await vi.advanceTimersByTimeAsync(250);
    vi.mocked(api.reportState).mockClear();
    vi.mocked(api.reportState).mockResolvedValue({ kind: 'need_queue' });

    usePlayerStore.setState({ playing: false });
    await vi.advanceTimersByTimeAsync(250);

    expect(api.reportState).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.reportState).mock.calls[1][0].queueIds).toEqual(['a', 'b']);
  });

  it('sends nothing for an empty queue or while the connection is down', async () => {
    usePlayerStore.setState({ playing: true });
    await vi.advanceTimersByTimeAsync(250);
    expect(api.reportState).not.toHaveBeenCalled();

    useConnectStore.setState({ status: 'offline' });
    play();
    await vi.advanceTimersByTimeAsync(250);
    expect(api.reportState).not.toHaveBeenCalled();
  });

  it('a paused bystander stays quiet, but starting playback here takes over from the other device', async () => {
    otherIsPlaying();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.reportState).not.toHaveBeenCalled(); // mirroring is not "the user doing something"

    usePlayerStore.setState({ queue: [song('a')], queueIndex: 0, currentSong: song('a'), playing: false });
    await vi.advanceTimersByTimeAsync(250);
    expect(api.reportState).not.toHaveBeenCalled();

    usePlayerStore.setState({ playing: true });
    await vi.advanceTimersByTimeAsync(250);
    expect(api.reportState).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.reportState).mock.calls[0][0]).toMatchObject({ playing: true, queueIds: ['a'] });
  });

  it('while the takeover is in flight the mirror does not put the other device\'s track back over the one just started here', async () => {
    otherIsPlaying();
    usePlayerStore.setState({ queue: [song('a')], queueIndex: 0, currentSong: song('a'), playing: true });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(usePlayerStore.getState().currentSong?.id).toBe('a');
    expect(usePlayerStore.getState().queue).toHaveLength(1);

    // confirmed: this device is now the active one and mirroring stays off
    handle('devices', { devices: [device(ME, { active: true }), device(OTHER)], activeDeviceId: ME });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(usePlayerStore.getState().currentSong?.id).toBe('a');
  });

  it('if the takeover is never confirmed (e.g. the browser blocked autoplay) the mirror resumes after a few seconds', async () => {
    otherIsPlaying();
    usePlayerStore.setState({ queue: [song('a')], queueIndex: 0, currentSong: song('a'), playing: false });

    await vi.advanceTimersByTimeAsync(7_000);
    expect(usePlayerStore.getState().currentSong?.id).toBe('a');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(usePlayerStore.getState().currentSong?.title).toBe('Remote Song');
  });

  it('adding to the queue while remote is not mistaken for a takeover', async () => {
    otherIsPlaying();
    usePlayerStore.getState().addToQueue(song('x'));

    await vi.advanceTimersByTimeAsync(300);

    expect(usePlayerStore.getState().currentSong?.title).toBe('Remote Song');
  });

  it('reports a seek, but not ordinary playback progress', async () => {
    useConnectStore.setState({ activeDeviceId: ME });
    play({ currentTime: 10 });
    await vi.advanceTimersByTimeAsync(250);
    vi.mocked(api.reportState).mockClear();

    for (let i = 1; i <= 8; i++) {
      await vi.advanceTimersByTimeAsync(250);
      usePlayerStore.setState({ currentTime: 10 + i * 0.25 });
    }
    await vi.advanceTimersByTimeAsync(250);
    expect(api.reportState).not.toHaveBeenCalled();

    usePlayerStore.setState({ currentTime: 120 }); // a jump
    await vi.advanceTimersByTimeAsync(250);
    expect(api.reportState).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.reportState).mock.calls[0][0].positionMs).toBe(120_000);
  });

  it('re-reports every ten seconds while playing here (drift correction), not while paused or remote', async () => {
    useConnectStore.setState({ activeDeviceId: ME });
    play();
    await vi.advanceTimersByTimeAsync(250);
    vi.mocked(api.reportState).mockClear();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.reportState).toHaveBeenCalledTimes(1);

    usePlayerStore.setState({ playing: false });
    await vi.advanceTimersByTimeAsync(250);
    vi.mocked(api.reportState).mockClear();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.reportState).not.toHaveBeenCalled();
  });

  it('reports the queue again after a (re)connect, since the server may have restarted', async () => {
    useConnectStore.setState({ activeDeviceId: ME });
    play();
    await vi.advanceTimersByTimeAsync(250);
    vi.mocked(api.reportState).mockClear();

    handle('snapshot', { devices: [device(ME, { active: true })], activeDeviceId: ME, state: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(api.reportState).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.reportState).mock.calls[0][0].queueIds).toEqual(['a', 'b']);
  });

  it('gives up cleanly against a server without Connect', async () => {
    vi.mocked(api.reportState).mockResolvedValue({ kind: 'unavailable' });
    play();
    await vi.advanceTimersByTimeAsync(250);

    expect(connectState().status).toBe('unavailable');
    expect(remoteRegistry.current).toBeNull();
  });
});

// ── Transfer and rename ──────────────────────────────────────────────────────

describe('transfer and rename', () => {
  it('transferTo asks the server to move playback from this device to the chosen one', async () => {
    await connectState().transferTo(OTHER);
    expect(api.transferPlayback).toHaveBeenCalledWith(ME, OTHER, true);
  });

  it('transferHere ("Continue here") targets this device', async () => {
    await connectState().transferHere();
    expect(api.transferPlayback).toHaveBeenCalledWith(ME, ME, true);
  });

  it.each([
    ['target_offline', 'That device is offline'],
    ['nothing_playing', 'Nothing has been played yet — start something first'],
    ['rate_limited', 'Slow down a little'],
    ['error', "Couldn't reach the server"],
  ] as const)('explains a "%s" result', async (result, message) => {
    vi.mocked(api.transferPlayback).mockResolvedValue(result);
    await connectState().transferTo(OTHER);
    expect(useToastStore.getState().message).toBe(message);
  });

  it.each(['ok', 'pending', 'noop'] as const)('stays quiet on "%s"', async (result) => {
    vi.mocked(api.transferPlayback).mockResolvedValue(result);
    await connectState().transferTo(OTHER);
    expect(useToastStore.getState().message).toBeNull();
  });

  it('renames this device: trims, caps at 40 characters, remembers it and tells the server', async () => {
    await connectState().renameThisDevice(`  ${'x'.repeat(60)}  `);

    expect(connectState().deviceName).toBe('x'.repeat(40));
    expect(localStorage.getItem('riffplayer-device-name')).toBe('x'.repeat(40));
    expect(api.renameDevice).toHaveBeenCalledWith(ME, 'x'.repeat(40));
  });

  it('keeps the new name locally even while offline, and ignores a blank one', async () => {
    useConnectStore.setState({ status: 'offline' });
    await connectState().renameThisDevice('Kitchen laptop');
    expect(connectState().deviceName).toBe('Kitchen laptop');
    expect(api.renameDevice).not.toHaveBeenCalled();

    await connectState().renameThisDevice('   ');
    expect(connectState().deviceName).toBe('Kitchen laptop');
  });
});

// ── The connection itself ────────────────────────────────────────────────────

interface FakeStream {
  response: Response;
  push: (text: string) => void;
  end: () => void;
  aborted: () => boolean;
}

const sse = (name: string, data: unknown, id = 1) => `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

function fakeStream(signal: AbortSignal, status = 200): FakeStream {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const encoder = new TextEncoder();
  let aborted = false;
  signal.addEventListener('abort', () => {
    aborted = true;
    try { controller.error(new DOMException('Aborted', 'AbortError')); } catch { /* already closed */ }
  });
  return {
    response: new Response(status === 200 ? body : null, { status }),
    push: (text) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    aborted: () => aborted,
  };
}

describe('the connection loop', () => {
  let streams: FakeStream[];

  beforeEach(() => {
    streams = [];
    useConnectStore.setState({ status: 'idle' });
    vi.mocked(api.openStream).mockImplementation((_identity, signal) => {
      const s = fakeStream(signal);
      streams.push(s);
      return Promise.resolve(s.response);
    });
  });

  const hello = () => sse('hello', { serverTimeMs: Date.now(), you: ME }, 1);
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

  it('opens a stream with this device\'s identity and goes online on hello', async () => {
    connectState().start();
    expect(connectState().status).toBe('connecting');
    await tick();

    expect(api.openStream).toHaveBeenCalledWith({ deviceId: ME, name: 'My PC', type: 'web' }, expect.any(AbortSignal));
    streams[0].push(hello());
    await tick();
    expect(connectState().status).toBe('online');
  });

  it('handles events split across network chunks', async () => {
    connectState().start();
    await tick();
    const snapshot = sse('snapshot', { devices: [device(ME), device(OTHER)], activeDeviceId: null, state: null }, 2);

    streams[0].push(hello());
    streams[0].push(snapshot.slice(0, 20));
    await tick();
    expect(connectState().devices).toEqual([]);
    streams[0].push(snapshot.slice(20));
    await tick();

    expect(connectState().devices.map((d) => d.id)).toEqual([ME, OTHER]);
  });

  it('registers itself as the remote controller while running and removes itself on stop', async () => {
    connectState().start();
    expect(remoteRegistry.current).not.toBeNull();

    connectState().stop();

    expect(remoteRegistry.current).toBeNull();
    expect(connectState().status).toBe('idle');
    expect(connectState().devices).toEqual([]);
  });

  it('stop aborts the open stream, and starting twice does not open two', async () => {
    connectState().start();
    connectState().start();
    await tick();
    expect(api.openStream).toHaveBeenCalledTimes(1);

    connectState().stop();
    await tick();

    expect(streams[0].aborted()).toBe(true);
  });

  it('stop() followed at once by start() leaves exactly one connection loop (the old one must not wake up and carry on)', async () => {
    const answers: ((r: Response) => void)[] = [];
    vi.mocked(api.openStream).mockImplementation(() => new Promise<Response>((r) => answers.push(r)));

    connectState().start();
    await tick();
    connectState().stop();
    connectState().start();
    await tick();
    expect(api.openStream).toHaveBeenCalledTimes(2);

    // the first, abandoned attempt now gets an answer: a stream that ends straight away
    const stale = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
    answers[0](new Response(stale, { status: 200 }));
    await tick(10_000);

    expect(api.openStream).toHaveBeenCalledTimes(2);
    // ...and it must not have meddled with the new session either (it would mark the connection offline)
    expect(connectState().status).toBe('connecting');
  });

  it('an older server without /connect hides the feature and stops trying', async () => {
    vi.mocked(api.openStream).mockImplementation((_i, signal) => Promise.resolve(fakeStream(signal, 404).response));
    connectState().start();
    await tick();
    await tick(60_000);

    expect(connectState().status).toBe('unavailable');
    expect(remoteRegistry.current).toBeNull();
    expect(api.openStream).toHaveBeenCalledTimes(1);
  });

  it('reconnects after the stream ends, waiting about a second first', async () => {
    connectState().start();
    await tick();
    streams[0].push(hello());
    await tick();

    streams[0].end();
    await tick();
    expect(connectState().status).toBe('offline');
    expect(api.openStream).toHaveBeenCalledTimes(1);

    await tick(1_300);
    expect(api.openStream).toHaveBeenCalledTimes(2);
  });

  it('backs off further while the server stays unreachable', async () => {
    vi.mocked(api.openStream).mockRejectedValue(new TypeError('Failed to fetch'));
    connectState().start();
    await tick();
    expect(api.openStream).toHaveBeenCalledTimes(1);

    await tick(1_300); // ~1 s
    expect(api.openStream).toHaveBeenCalledTimes(2);
    await tick(1_300); // second wait is ~2 s, so nothing yet
    expect(api.openStream).toHaveBeenCalledTimes(2);
    await tick(1_500);
    expect(api.openStream).toHaveBeenCalledTimes(3);
  });

  it('retries at once when the network comes back instead of waiting out the backoff', async () => {
    vi.mocked(api.openStream).mockRejectedValue(new TypeError('Failed to fetch'));
    connectState().start();
    await tick();
    await tick(1_300);
    expect(api.openStream).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event('online'));
    await tick();

    expect(api.openStream).toHaveBeenCalledTimes(3);
  });

  it('aborts a stream that never says hello, and after two such attempts switches to long-polling', async () => {
    vi.mocked(api.pollOnce).mockReturnValue(new Promise(() => {}));
    connectState().start();
    await tick();

    await tick(8_100); // first silent stream aborted
    expect(streams[0].aborted()).toBe(true);
    expect(connectState().transport).toBe('stream');

    await tick(1_300); // reconnects
    expect(api.openStream).toHaveBeenCalledTimes(2);
    await tick(8_100); // second silent stream aborted

    expect(connectState().transport).toBe('poll');
    await tick(2_500);
    expect(api.pollOnce).toHaveBeenCalled();
  });

  it('a stream that goes quiet for 45 seconds (not even heartbeats) is treated as dead', async () => {
    connectState().start();
    await tick();
    streams[0].push(hello());
    await tick();

    await tick(50_000);

    expect(streams[0].aborted()).toBe(true);
  });

  it('heartbeats keep a quiet stream alive', async () => {
    connectState().start();
    await tick();
    streams[0].push(hello());
    for (let i = 0; i < 6; i++) {
      await tick(20_000);
      streams[0].push(': ping\n\n');
    }
    await tick();

    expect(streams[0].aborted()).toBe(false);
    expect(connectState().status).toBe('online');
  });

  it('a stream that stayed healthy resets the backoff for the next failure', async () => {
    connectState().start();
    await tick();
    streams[0].push(hello());
    await tick();
    for (let i = 0; i < 3; i++) { await tick(20_000); streams[0].push(': ping\n\n'); }
    streams[0].end();
    await tick();

    await tick(1_300);

    expect(api.openStream).toHaveBeenCalledTimes(2);
  });

  it('after earlier failures, one healthy connection brings the next retry back to about a second', async () => {
    const real = vi.mocked(api.openStream).getMockImplementation()!;
    vi.mocked(api.openStream)
      .mockRejectedValueOnce(new TypeError('down'))
      .mockRejectedValueOnce(new TypeError('down'))
      .mockRejectedValueOnce(new TypeError('down'))
      .mockImplementation(real);

    connectState().start();
    await tick();
    await tick(1_300); // 2nd attempt (after ~1 s)
    await tick(2_600); // 3rd attempt (after ~2 s)
    await tick(5_000); // 4th attempt (after ~4 s): the first one that connects
    expect(api.openStream).toHaveBeenCalledTimes(4);
    streams[0].push(hello());
    for (let i = 0; i < 3; i++) { await tick(20_000); streams[0].push(': ping\n\n'); }

    streams[0].end();
    await tick();
    await tick(1_300);

    expect(api.openStream).toHaveBeenCalledTimes(5);
  });

  it('does not keep re-reporting a queue it is only mirroring while another device plays', async () => {
    startOnline();
    otherIsPlaying();

    await vi.advanceTimersByTimeAsync(35_000);

    expect(api.reportState).not.toHaveBeenCalled();
  });

  describe('long-poll mode', () => {
    /** The real way in: two streams in a row that never say hello. */
    async function enterPollMode() {
      connectState().start();
      await tick();
      await tick(8_100);
      await tick(1_300);
      await tick(8_100);
      expect(connectState().transport).toBe('poll');
    }
    const ev = (seq: number, event: string, data: unknown) => ({ seq, event, data });

    it('registers with a first poll and keeps asking for events after the last sequence number it saw', async () => {
      vi.mocked(api.pollOnce)
        .mockResolvedValueOnce({ status: 200, events: [ev(1, 'hello', { serverTimeMs: Date.now(), you: ME }), ev(2, 'snapshot', { devices: [device(ME)], activeDeviceId: null, state: null })] })
        .mockResolvedValueOnce({ status: 200, events: [ev(3, 'devices', { devices: [device(ME), device(OTHER)], activeDeviceId: null })] })
        .mockReturnValue(new Promise(() => {}));

      await enterPollMode();
      await tick(2_500);

      expect(vi.mocked(api.pollOnce).mock.calls.map((c) => c[1])).toEqual([undefined, 2, 3]);
      expect(connectState().status).toBe('online');
      expect(connectState().devices.map((d) => d.id)).toEqual([ME, OTHER]);
    });

    it('a server without /connect ends polling and hides the feature', async () => {
      vi.mocked(api.pollOnce).mockResolvedValue({ status: 404, events: [] });

      await enterPollMode();
      await tick(2_500);

      expect(connectState().status).toBe('unavailable');
    });

    it('a refused poll (e.g. rate limited) goes offline and is retried later', async () => {
      vi.mocked(api.pollOnce).mockResolvedValue({ status: 429, events: [] });

      await enterPollMode();
      await tick(2_500);
      expect(connectState().status).toBe('offline');
      const first = vi.mocked(api.pollOnce).mock.calls.length;

      await tick(10_000);
      expect(vi.mocked(api.pollOnce).mock.calls.length).toBeGreaterThan(first);
    });
  });
});

// ── Resume where you left off ────────────────────────────────────────────────

describe('resume where you left off', () => {
  const saved = (over: Record<string, unknown> = {}) => ({
    songs: [song('a'), song('b'), song('c')], current: 'b', positionMs: 83_000,
    changed: new Date().toISOString(), ...over,
  });
  const noOneIsPlaying = () => handle('snapshot', { devices: [device(ME)], activeDeviceId: null, state: null });
  type Restore = (songs: Song[], index: number, positionMs: number, play: boolean, counted?: boolean) => void;
  let restoreQueue: Mock<Restore>;

  beforeEach(() => {
    startOnline();
    restoreQueue = vi.fn<Restore>();
    usePlayerStore.setState({ restoreQueue });
  });

  describe('loading', () => {
    it('puts the saved queue back, paused, at the saved song and position — when nothing is playing anywhere', async () => {
      vi.mocked(subsonic.getPlayQueue).mockResolvedValue(saved());

      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(0);

      expect(restoreQueue).toHaveBeenCalledTimes(1);
      const [songs, index, positionMs, play, counted] = restoreQueue.mock.calls[0];
      expect(songs.map((x: Song) => x.id)).toEqual(['a', 'b', 'c']);
      expect([index, positionMs, play, counted]).toEqual([1, 83_000, false, false]);
    });

    it('starts at the first song when the saved current song is no longer in the queue', async () => {
      vi.mocked(subsonic.getPlayQueue).mockResolvedValue(saved({ current: 'gone' }));
      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(0);
      expect(restoreQueue.mock.calls[0][1]).toBe(0);
    });

    it('does nothing when another device is already playing', async () => {
      vi.mocked(subsonic.getPlayQueue).mockResolvedValue(saved());
      otherIsPlaying();
      await vi.advanceTimersByTimeAsync(0);

      expect(subsonic.getPlayQueue).not.toHaveBeenCalled();
      expect(restoreQueue).not.toHaveBeenCalled();
    });

    it('does nothing when this device already has a queue', async () => {
      vi.mocked(subsonic.getPlayQueue).mockResolvedValue(saved());
      usePlayerStore.setState({ queue: [song('local')], queueIndex: 0, currentSong: song('local') });

      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(0);

      expect(subsonic.getPlayQueue).not.toHaveBeenCalled();
      expect(restoreQueue).not.toHaveBeenCalled();
    });

    it('only tries once per connection session (a later snapshot does not fetch again)', async () => {
      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(0);
      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(0);

      expect(subsonic.getPlayQueue).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no queue was saved', async () => {
      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(0);
      expect(restoreQueue).not.toHaveBeenCalled();
    });

    it('ignores a queue saved more than 30 days ago', async () => {
      vi.mocked(subsonic.getPlayQueue).mockResolvedValue(saved({ changed: new Date(Date.now() - 31 * 86_400_000).toISOString() }));
      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(0);
      expect(restoreQueue).not.toHaveBeenCalled();
    });

    it('does not overwrite something the user started while the saved queue was being fetched', async () => {
      let finish!: (v: ReturnType<typeof saved>) => void;
      vi.mocked(subsonic.getPlayQueue).mockReturnValue(new Promise((r) => { finish = r as never; }) as never);

      noOneIsPlaying();
      usePlayerStore.setState({ queue: [song('local')], queueIndex: 0, currentSong: song('local') });
      finish(saved());
      await vi.advanceTimersByTimeAsync(0);

      expect(restoreQueue).not.toHaveBeenCalled();
    });

    it('survives a failing request', async () => {
      vi.mocked(subsonic.getPlayQueue).mockRejectedValue(new Error('offline'));
      expect(() => noOneIsPlaying()).not.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      expect(restoreQueue).not.toHaveBeenCalled();
    });

    it('is tried again after the connection is stopped and started', async () => {
      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(0);
      connectState().stop();
      startOnline();
      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(0);

      expect(subsonic.getPlayQueue).toHaveBeenCalledTimes(2);
    });
  });

  describe('saving', () => {
    const play = (over: Record<string, unknown> = {}) =>
      usePlayerStore.setState({
        queue: [song('a'), song('b'), song('c')], queueIndex: 1, currentSong: song('b'), playing: true, currentTime: 12.3,
        ...over,
      });
    const saves = () => vi.mocked(subsonic.savePlayQueue).mock.calls;

    beforeEach(() => {
      useConnectStore.setState({ activeDeviceId: ME });
    });

    it('saves the queue, the current song and the position once this device plays', async () => {
      play();
      await vi.advanceTimersByTimeAsync(250);

      expect(saves()).toEqual([[['a', 'b', 'c'], 'b', 12_300]]);
    });

    it('saves at once when playback is paused or the track changes, even right after a save', async () => {
      play();
      await vi.advanceTimersByTimeAsync(250);

      usePlayerStore.setState({ playing: false });
      await vi.advanceTimersByTimeAsync(250);
      expect(saves().length).toBe(2);

      usePlayerStore.setState({ queueIndex: 2, currentSong: song('c') });
      await vi.advanceTimersByTimeAsync(250);
      expect(saves().length).toBe(3);
      expect(saves()[2][1]).toBe('c');
    });

    it('does not save again for mere playback progress until ten seconds have passed', async () => {
      play();
      await vi.advanceTimersByTimeAsync(250);
      expect(saves().length).toBe(1);

      await vi.advanceTimersByTimeAsync(9_000);
      expect(saves().length).toBe(1);

      usePlayerStore.setState({ currentTime: 22 });
      await vi.advanceTimersByTimeAsync(2_000); // the 10 s drift report
      expect(saves().length).toBe(2);
      expect(saves()[1][2]).toBe(22_000);
    });

    it('saves nothing while another device is the one playing, or without a queue, or while offline', async () => {
      otherIsPlaying();
      await vi.advanceTimersByTimeAsync(11_000);
      expect(saves()).toEqual([]);

      useConnectStore.setState({ activeDeviceId: ME });
      usePlayerStore.setState({ queue: [], currentSong: null, queueIndex: -1, playing: true });
      await vi.advanceTimersByTimeAsync(11_000);
      expect(saves()).toEqual([]);

      useConnectStore.setState({ status: 'offline' });
      play();
      await vi.advanceTimersByTimeAsync(11_000);
      expect(saves()).toEqual([]);
    });

    it('keeps the saved queue to a window around the current song (a huge queue would be slow to send and store)', async () => {
      const queue = Array.from({ length: 800 }, (_, i) => song(`s${i}`));

      play({ queue, queueIndex: 700, currentSong: queue[700] });
      await vi.advanceTimersByTimeAsync(250);
      let ids = saves().at(-1)![0];
      expect(ids.length).toBe(150); // 650 .. 799
      expect([ids[0], ids.at(-1)]).toEqual(['s650', 's799']);
      expect(ids).toContain('s700');

      play({ queue, queueIndex: 10, currentSong: queue[10] });
      await vi.advanceTimersByTimeAsync(250);
      ids = saves().at(-1)![0];
      expect(ids.length).toBe(500);
      expect(ids[0]).toBe('s0');
      expect(ids).toContain('s10');
    });

    it('survives a failing save', async () => {
      vi.mocked(subsonic.savePlayQueue).mockRejectedValue(new Error('offline'));
      play();
      await vi.advanceTimersByTimeAsync(250);
      expect(saves().length).toBe(1);
    });

    it('does not immediately write back the queue it just restored', async () => {
      vi.mocked(subsonic.getPlayQueue).mockResolvedValue(saved());
      useConnectStore.setState({ activeDeviceId: null });
      // the real restoreQueue loads the queue into the player straight away; emulate that
      restoreQueue.mockImplementation((songs, index, positionMs) =>
        usePlayerStore.setState({ queue: songs, queueIndex: index, currentSong: songs[index], playing: false, currentTime: positionMs / 1000 }),
      );
      noOneIsPlaying();
      await vi.advanceTimersByTimeAsync(500);

      expect(saves()).toEqual([]);
    });
  });
});


// ── Phase 2: the other device's volume and queue ─────────────────────────────

describe('remote volume', () => {
  beforeEach(() => {
    startOnline();
    otherIsPlaying({ volume: 0.6 });
  });

  it('the bar and shortcuts adjust the other device\'s volume, never this device\'s own', async () => {
    usePlayerStore.setState({ volume: 0.9 });
    usePlayerStore.getState().setVolume(0.3);
    await vi.advanceTimersByTimeAsync(0);

    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'volume', undefined, OTHER, { volume: 0.3 });
    expect(usePlayerStore.getState().volume).toBe(0.9);
    expect(FakeAudio.instance.volume).not.toBe(0.3);
    expect(connectState().remote?.volume).toBe(0.3); // the slider moves at once
  });

  it('knows the other device\'s volume (1 if the server is older and says nothing)', () => {
    expect(remoteRegistry.current?.volume()).toBe(0.6);
    handle('state', remoteState({ volume: undefined }));
    expect(remoteRegistry.current?.volume()).toBe(1);
  });

  it('sends a drag at a steady pace and always ends with the final value', async () => {
    const set = usePlayerStore.getState().setVolume;
    set(0.1); set(0.2); set(0.3); set(0.4);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sendCommand).toHaveBeenCalledTimes(1); // the first value goes out at once
    expect(api.sendCommand).toHaveBeenLastCalledWith(ME, 'volume', undefined, OTHER, { volume: 0.1 });

    await vi.advanceTimersByTimeAsync(150);
    expect(api.sendCommand).toHaveBeenCalledTimes(2);
    expect(api.sendCommand).toHaveBeenLastCalledWith(ME, 'volume', undefined, OTHER, { volume: 0.4 }); // not 0.2/0.3

    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.sendCommand).toHaveBeenCalledTimes(2); // nothing is sent twice
  });

  it('clamps to 0..1', async () => {
    usePlayerStore.getState().setVolume(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sendCommand).toHaveBeenLastCalledWith(ME, 'volume', undefined, OTHER, { volume: 1 });
  });

  it('a state report about the old value does not drag the slider back, a later one does', async () => {
    usePlayerStore.getState().setVolume(0.2);
    await vi.advanceTimersByTimeAsync(0);

    handle('state', remoteState({ volume: 0.6 })); // generated before the device heard about it
    expect(connectState().remote?.volume).toBe(0.2);

    await vi.advanceTimersByTimeAsync(2_000);
    handle('state', remoteState({ volume: 0.5 }));
    expect(connectState().remote?.volume).toBe(0.5);
  });

  it('mute remembers the other device\'s volume and restores it', async () => {
    usePlayerStore.getState().toggleMute();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sendCommand).toHaveBeenLastCalledWith(ME, 'volume', undefined, OTHER, { volume: 0 });

    await vi.advanceTimersByTimeAsync(200);
    usePlayerStore.getState().toggleMute();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sendCommand).toHaveBeenLastCalledWith(ME, 'volume', undefined, OTHER, { volume: 0.6 });
  });

  it('is applied to this device\'s own player when another device asks for it, and reported back', async () => {
    stopRemote();
    handle('command', { commandId: 'v-1', type: 'volume', volume: 0.35, expiresAtMs: Date.now() + 5_000 });
    expect(usePlayerStore.getState().volume).toBe(0.35);
    expect(FakeAudio.instance.volume).toBe(0.35);

    handle('command', { commandId: 'v-2', type: 'volume', volume: 9, expiresAtMs: Date.now() + 5_000 });
    expect(usePlayerStore.getState().volume).toBe(1);
    handle('command', { commandId: 'v-3', type: 'volume', volume: 'loud', expiresAtMs: Date.now() + 5_000 });
    expect(usePlayerStore.getState().volume).toBe(1); // garbage is ignored
  });

  it('this device reports its volume, so the others can show it', async () => {
    stopRemote();
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 0, currentSong: song('a'), playing: true, volume: 0.4 });
    await vi.advanceTimersByTimeAsync(250);
    expect(api.reportState).toHaveBeenLastCalledWith(expect.objectContaining({ volume: 0.4 }));

    vi.mocked(api.reportState).mockClear();
    usePlayerStore.getState().setVolume(0.8);
    await vi.advanceTimersByTimeAsync(250);
    expect(api.reportState).toHaveBeenCalledTimes(1);
    expect(api.reportState).toHaveBeenLastCalledWith(expect.objectContaining({ volume: 0.8 }));
  });

  /** This device becomes the playing one. */
  function stopRemote() {
    handle('snapshot', { devices: [device(ME, { active: true }), device(OTHER)], activeDeviceId: ME, state: null });
  }
});

describe('the other device\'s queue', () => {
  const queueOf = (ids: string[], version = 1, over: Record<string, unknown> = {}) => ({
    queueVersion: version, index: 0, songs: ids.map((id) => song(id)), positions: ids.map((_, i) => i), ...over,
  });
  let unwatch: () => void;

  beforeEach(() => {
    startOnline();
    vi.mocked(api.fetchQueue).mockResolvedValue(queueOf(['a', 'b', 'c', 'd']));
    otherIsPlaying({ queueVersion: 1, index: 1, queueLength: 4 });
  });
  afterEach(() => unwatch?.());

  async function watch() {
    unwatch = connectState().watchRemoteQueue();
    await vi.advanceTimersByTimeAsync(0);
  }

  it('is fetched only while someone watches, and the current song follows the device\'s index', async () => {
    expect(api.fetchQueue).not.toHaveBeenCalled();
    expect(connectState().remoteQueue).toBeNull();

    await watch();
    expect(api.fetchQueue).toHaveBeenCalledTimes(1);
    expect(connectState().remoteQueue?.songs.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(connectState().remoteQueue?.index).toBe(1); // from the state, not the fetch (which said 0)

    handle('state', remoteState({ queueVersion: 1, index: 3, queueLength: 4 }));
    expect(connectState().remoteQueue?.index).toBe(3);
    expect(api.fetchQueue).toHaveBeenCalledTimes(1); // a new current song needs no refetch
  });

  it('is fetched again when the queue itself changes, but not when a report repeats the same version', async () => {
    await watch();
    vi.mocked(api.fetchQueue).mockResolvedValue(queueOf(['a', 'b', 'x', 'c', 'd'], 2));

    handle('state', remoteState({ queueVersion: 1, index: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.fetchQueue).toHaveBeenCalledTimes(1);

    handle('state', remoteState({ queueVersion: 2, index: 1, queueLength: 5 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.fetchQueue).toHaveBeenCalledTimes(2);
    expect(connectState().remoteQueue?.songs).toHaveLength(5);
  });

  it('stops fetching when the last watcher leaves, and drops the view when this device plays again', async () => {
    await watch();
    unwatch();
    handle('state', remoteState({ queueVersion: 2 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.fetchQueue).toHaveBeenCalledTimes(1);

    await watch();
    expect(connectState().remoteQueue).not.toBeNull();
    handle('snapshot', { devices: [device(ME, { active: true }), device(OTHER)], activeDeviceId: ME, state: null });
    expect(connectState().remoteQueue).toBeNull();
  });

  it('survives a failed fetch and tries again on the next state', async () => {
    vi.mocked(api.fetchQueue).mockResolvedValueOnce(null);
    await watch();
    expect(connectState().remoteQueue).toBeNull();

    handle('state', remoteState({ queueVersion: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(connectState().remoteQueue?.songs).toHaveLength(4);
  });

  it('removing a song is sent with its real position and id, and shown at once', async () => {
    await watch();
    usePlayerStore.getState().removeFromQueue(2);
    await vi.advanceTimersByTimeAsync(0);

    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'queue_remove', undefined, OTHER, { index: 2, songId: 'c' });
    expect(connectState().remoteQueue?.songs.map((s) => s.id)).toEqual(['a', 'b', 'd']);
  });

  it('a library that dropped some ids: edits use the real positions, not the shown ones', async () => {
    vi.mocked(api.fetchQueue).mockResolvedValue(queueOf(['a', 'c', 'd'], 1, { positions: [0, 2, 3] }));
    await watch();

    usePlayerStore.getState().removeFromQueue(1); // "c" is shown 2nd but sits at real position 2
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'queue_remove', undefined, OTHER, { index: 2, songId: 'c' });
  });

  it('reordering is sent from/to in real positions and shown at once', async () => {
    await watch();
    usePlayerStore.getState().reorderQueue(0, 3);
    await vi.advanceTimersByTimeAsync(0);

    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'queue_move', undefined, OTHER, { index: 0, to: 3, songId: 'a' });
    expect(connectState().remoteQueue?.songs.map((s) => s.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(connectState().remoteQueue?.index).toBe(0); // the playing "b" moved up with the list
  });

  it('playing a queue item jumps there on the other device', async () => {
    await watch();
    connectState().playRemoteQueueItem(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'queue_play', undefined, OTHER, { index: 3, songId: 'd' });
  });

  it('edits nothing (and says nothing) when the queue has not been loaded or the index is stale', async () => {
    usePlayerStore.getState().removeFromQueue(0); // not watching: no view
    usePlayerStore.getState().reorderQueue(0, 1);
    connectState().playRemoteQueueItem(0);
    await watch();
    vi.mocked(api.sendCommand).mockClear();
    usePlayerStore.getState().removeFromQueue(9);
    usePlayerStore.getState().reorderQueue(0, 9);
    connectState().playRemoteQueueItem(9);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });
});

describe('adding to the other device\'s queue', () => {
  beforeEach(() => {
    startOnline();
    otherIsPlaying();
  });

  it('"add to queue" and "play next" reach the other device instead of this device\'s own queue', async () => {
    usePlayerStore.getState().addToQueue(song('x'));
    usePlayerStore.getState().playNext(song('y'));
    await vi.advanceTimersByTimeAsync(100);

    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'queue_add', undefined, OTHER, { mode: 'end', songIds: ['x'] });
    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'queue_add', undefined, OTHER, { mode: 'next', songIds: ['y'] });
    expect(usePlayerStore.getState().queue).toEqual([]); // this device's own queue stays empty (and it never starts reporting)
    expect(api.reportState).not.toHaveBeenCalled();
  });

  it('an album\'s worth of "play next" calls (last song first) is one command, in listening order', async () => {
    for (const id of ['s3', 's2', 's1']) usePlayerStore.getState().playNext(song(id));
    await vi.advanceTimersByTimeAsync(100);

    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'queue_add', undefined, OTHER, { mode: 'next', songIds: ['s1', 's2', 's3'] });
  });

  it('adding at the end keeps the call order', async () => {
    for (const id of ['s1', 's2', 's3']) usePlayerStore.getState().addToQueue(song(id));
    await vi.advanceTimersByTimeAsync(100);
    expect(api.sendCommand).toHaveBeenCalledWith(ME, 'queue_add', undefined, OTHER, { mode: 'end', songIds: ['s1', 's2', 's3'] });
  });

  it('splits very large additions into commands the server accepts, the first block first in the queue', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => `s${i}`);
    for (const id of ids) usePlayerStore.getState().addToQueue(song(id));
    await vi.advanceTimersByTimeAsync(100);

    const sent = vi.mocked(api.sendCommand).mock.calls.map((c) => (c[4] as { songIds: string[] }).songIds);
    expect(sent.map((c) => c.length)).toEqual([100, 100, 30]);
    expect(sent.flat()).toEqual(ids);

    vi.mocked(api.sendCommand).mockClear();
    for (const id of [...ids].reverse()) usePlayerStore.getState().playNext(song(id));
    await vi.advanceTimersByTimeAsync(100);
    const nextSent = vi.mocked(api.sendCommand).mock.calls.map((c) => (c[4] as { songIds: string[] }).songIds);
    expect(nextSent.map((c) => c.length)).toEqual([30, 100, 100]); // last block goes first: each is inserted right after the current song
    expect(nextSent[2]).toEqual(ids.slice(0, 100));
  });

  it('says where the songs went, once the other device has them', async () => {
    usePlayerStore.getState().addToQueue(song('x'));
    usePlayerStore.getState().addToQueue(song('y'));
    await vi.advanceTimersByTimeAsync(100);
    expect(useToastStore.getState().message).toBe('Added 2 songs to the queue on Phone');

    usePlayerStore.getState().playNext(song('z'));
    await vi.advanceTimersByTimeAsync(100);
    expect(useToastStore.getState().message).toBe('1 song will play next on Phone');
  });

  it('does not claim success when the command was not delivered', async () => {
    vi.mocked(api.sendCommand).mockResolvedValue('no_active_device');
    usePlayerStore.getState().addToQueue(song('x'));
    await vi.advanceTimersByTimeAsync(100);
    expect(useToastStore.getState().message).toMatch(/isn't reachable/);
  });
});

describe('queue commands executed on this device', () => {
  const cmd = (type: string, over: Record<string, unknown> = {}) => ({
    commandId: `q-${Math.random()}`, type, expiresAtMs: Date.now() + 5_000, ...over,
  });
  const ids = () => usePlayerStore.getState().queue.map((s) => s.id);

  beforeEach(() => {
    startOnline();
    usePlayerStore.setState({ queue: ['a', 'b', 'c', 'd'].map((id) => song(id)), queueIndex: 1, currentSong: song('b'), playing: true });
  });

  it('queue_add: "end" appends, "next" inserts the block right after the current song in order', () => {
    handle('command', cmd('queue_add', { mode: 'end', songs: [song('x'), song('y')] }));
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'x', 'y']);

    handle('command', cmd('queue_add', { mode: 'next', songs: [song('n1'), song('n2')] }));
    expect(ids()).toEqual(['a', 'b', 'n1', 'n2', 'c', 'd', 'x', 'y']);
    expect(usePlayerStore.getState().queueIndex).toBe(1);
  });

  it('queue_add ignores junk and an unknown mode', () => {
    handle('command', cmd('queue_add', { mode: 'end', songs: [null, { title: 'no id' }, song('ok')] }));
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'ok']);
    handle('command', cmd('queue_add', { mode: 'sideways', songs: [song('no')] }));
    expect(ids()).not.toContain('no');
  });

  it('queue_remove removes the named song', () => {
    handle('command', cmd('queue_remove', { index: 3, songId: 'd' }));
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('queue_remove is dropped when the song at that index is not the one the sender saw', () => {
    handle('command', cmd('queue_remove', { index: 3, songId: 'c' }));
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('queue_remove never removes the song that is playing', () => {
    handle('command', cmd('queue_remove', { index: 1, songId: 'b' }));
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(usePlayerStore.getState().playing).toBe(true);
  });

  it('queue_move moves the named song and keeps the current one playing', () => {
    handle('command', cmd('queue_move', { index: 0, to: 3, songId: 'a' }));
    expect(ids()).toEqual(['b', 'c', 'd', 'a']);
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().queueIndex].id).toBe('b');
  });

  it('queue_move is dropped for a stale index or a destination outside the queue', () => {
    handle('command', cmd('queue_move', { index: 0, to: 3, songId: 'zzz' }));
    handle('command', cmd('queue_move', { index: 0, to: 9, songId: 'a' }));
    handle('command', cmd('queue_move', { index: 0, to: -1, songId: 'a' }));
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('queue_play jumps to the named song without disturbing the queue order', () => {
    usePlayerStore.setState({ shuffle: true, originalQueue: ['a', 'b', 'c', 'd'].map((id) => song(id)) });
    handle('command', cmd('queue_play', { index: 3, songId: 'd' }));
    expect(usePlayerStore.getState().queueIndex).toBe(3);
    expect(usePlayerStore.getState().currentSong?.id).toBe('d');
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(usePlayerStore.getState().originalQueue).toHaveLength(4);
  });

  it('queue_play is dropped for a stale index', () => {
    handle('command', cmd('queue_play', { index: 3, songId: 'a' }));
    handle('command', cmd('queue_play', { index: 9, songId: 'd' }));
    expect(usePlayerStore.getState().queueIndex).toBe(1);
  });

  it('the edited queue is reported, so the other devices see the new version', async () => {
    handle('command', cmd('queue_add', { mode: 'end', songs: [song('x')] }));
    await vi.advanceTimersByTimeAsync(250);
    expect(api.reportState).toHaveBeenLastCalledWith(expect.objectContaining({ queueIds: ['a', 'b', 'c', 'd', 'x'] }));
  });
});
