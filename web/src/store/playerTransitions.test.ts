import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Song } from '../api/types';

// Own file on purpose: the player is a module singleton, and these tests make it create (and
// swap to) its second audio element — which would disturb the single-element tests in player.test.ts.
class FakeAudio {
  static all: FakeAudio[] = [];
  preload = '';
  src = '';
  volume = 1;
  paused = true;
  currentTime = 0;
  duration = 0;
  readyState = 4;
  private listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  constructor() {
    FakeAudio.all.push(this);
  }
  addEventListener(type: string, cb: (...a: unknown[]) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: (...a: unknown[]) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }
  emit(type: string) {
    for (const l of [...(this.listeners[type] ?? [])]) l();
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
}
vi.stubGlobal('Audio', FakeAudio);
vi.mock('../lib/offlineDb', () => ({ getTrackAudioBlob: () => Promise.resolve(null) }));
vi.mock('../api/subsonic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/subsonic')>()),
  scrobble: vi.fn().mockResolvedValue(undefined),
  streamUrl: (id: string) => `http://server/stream/${id}`,
}));

const { usePlayerStore } = await import('./player');
const { usePlaybackStore, replayGainLinear } = await import('./playback');

const flush = () => new Promise((r) => setTimeout(r, 0));
const song = (id: string, extra: Partial<Song> = {}): Song => ({
  id, title: `Track ${id}`, album: 'Album', albumId: 'al-1', artist: 'Artist', artistId: 'ar-1',
  created: '2024-01-01', isVideo: false, type: 'music', ...extra,
});

/** The element that is currently playing, whichever of the two it is. */
const playing = () => FakeAudio.all.filter((a) => !a.paused);

async function startQueue(songs: Song[], index = 0) {
  usePlayerStore.getState().playQueue(songs, index);
  await flush();
}

/** Puts the active element `secondsLeft` before the end of a 100 s track and lets the player react. */
function nearEnd(secondsLeft: number) {
  const active = playing()[0];
  active.duration = 100;
  active.currentTime = 100 - secondsLeft;
  active.emit('timeupdate');
}

beforeEach(() => {
  vi.useRealTimers();
  // The two elements are reused across tests: wipe what a previous test left on them.
  for (const a of FakeAudio.all) {
    a.src = '';
    a.paused = true;
    a.volume = 1;
    a.currentTime = 0;
    a.duration = 0;
  }
  usePlaybackStore.setState({ replayGain: 'track', preampDb: 0, gapless: true, crossfadeSec: 0 });
  usePlayerStore.setState({ queue: [], queueIndex: -1, currentSong: null, playing: false, repeatMode: 'off', shuffle: false, originalQueue: null, volume: 1 });
});

afterEach(() => {
  // Leave both elements silent so the next test's `playing()` only sees its own.
  for (const a of FakeAudio.all) a.pause();
  vi.useRealTimers();
});

describe('replayGainLinear', () => {
  const tagged = song('a', { replayGainTrackGain: -6, replayGainAlbumGain: -3 });

  it('is 1 when off or when the song carries no gain', () => {
    expect(replayGainLinear(tagged, 'off', 0)).toBe(1);
    expect(replayGainLinear(song('b'), 'track', 6)).toBe(1);
    expect(replayGainLinear(null, 'track', 0)).toBe(1);
  });

  it('track mode uses the track gain, album mode the album gain', () => {
    expect(replayGainLinear(tagged, 'track', 0)).toBeCloseTo(Math.pow(10, -6 / 20), 6);
    expect(replayGainLinear(tagged, 'album', 0)).toBeCloseTo(Math.pow(10, -3 / 20), 6);
  });

  it('album mode falls back to the track gain when there is no album gain', () => {
    expect(replayGainLinear(song('c', { replayGainTrackGain: -8 }), 'album', 0)).toBeCloseTo(Math.pow(10, -8 / 20), 6);
  });

  it('adds the preamp to the gain', () => {
    expect(replayGainLinear(tagged, 'track', 4)).toBeCloseTo(Math.pow(10, -2 / 20), 6);
  });
});

describe('playback settings', () => {
  it('clamps the preamp to ±12 dB in half-dB steps, and the crossfade to 0–12 s', () => {
    const s = usePlaybackStore.getState();
    s.setPreampDb(30);
    expect(usePlaybackStore.getState().preampDb).toBe(12);
    s.setPreampDb(-30);
    expect(usePlaybackStore.getState().preampDb).toBe(-12);
    s.setPreampDb(2.74);
    expect(usePlaybackStore.getState().preampDb).toBe(2.5);
    s.setCrossfadeSec(99);
    expect(usePlaybackStore.getState().crossfadeSec).toBe(12);
    s.setCrossfadeSec(-3);
    expect(usePlaybackStore.getState().crossfadeSec).toBe(0);
  });
});

describe('ReplayGain on the audio element', () => {
  const tagged = song('a', { replayGainTrackGain: -6, replayGainAlbumGain: -2 });

  it('uses the album gain in album mode', async () => {
    usePlaybackStore.setState({ replayGain: 'album' });
    await startQueue([tagged]);
    expect(playing()[0].volume).toBeCloseTo(Math.pow(10, -2 / 20), 5);
  });

  it('leaves the volume alone when ReplayGain is off', async () => {
    usePlaybackStore.setState({ replayGain: 'off' });
    await startQueue([tagged]);
    expect(playing()[0].volume).toBe(1);
  });

  it('keeps the gain when the user moves the volume slider', async () => {
    await startQueue([tagged]);
    usePlayerStore.getState().setVolume(0.5);
    expect(playing()[0].volume).toBeCloseTo(0.5 * Math.pow(10, -6 / 20), 5);
  });

  it('changing the mode applies to the track that is already playing', async () => {
    await startQueue([tagged]);
    usePlaybackStore.getState().setReplayGain('off');
    expect(playing()[0].volume).toBe(1);
    usePlaybackStore.getState().setReplayGain('album');
    expect(playing()[0].volume).toBeCloseTo(Math.pow(10, -2 / 20), 5);
  });
});

describe('gapless', () => {
  it('pre-loads the next track into a second element when the current one nears its end', async () => {
    await startQueue([song('a'), song('b')]);
    expect(FakeAudio.all.length).toBe(1); // nothing to prepare yet

    nearEnd(15);
    await flush();

    const spare = FakeAudio.all.find((a) => a.src.endsWith('/b'))!;
    expect(spare).toBeDefined();
    expect(spare.paused).toBe(true);
    expect(spare.preload).toBe('auto');
  });

  it('does not pre-load early in a long track', async () => {
    await startQueue([song('a'), song('b')]);
    nearEnd(60);
    await flush();
    expect(FakeAudio.all.some((a) => a.src.endsWith('/b'))).toBe(false);
  });

  it('does nothing when both gapless and crossfade are off', async () => {
    usePlaybackStore.setState({ gapless: false, crossfadeSec: 0 });
    await startQueue([song('a'), song('b')]);
    nearEnd(5);
    await flush();
    expect(FakeAudio.all.some((a) => a.src.endsWith('/b'))).toBe(false);
  });

  it('has nothing to pre-load on the last track, or under repeat-one', async () => {
    await startQueue([song('a'), song('b')], 1);
    nearEnd(5);
    await flush();
    expect(FakeAudio.all.some((a) => a.src.endsWith('/a'))).toBe(false);

    await startQueue([song('c'), song('d')]);
    usePlayerStore.setState({ repeatMode: 'one' }); // (picking a track by hand would have cleared it)
    nearEnd(5);
    await flush();
    expect(FakeAudio.all.some((a) => a.src.endsWith('/d'))).toBe(false);
  });

  it('under repeat-all, the last track pre-loads the first', async () => {
    usePlayerStore.setState({ repeatMode: 'all' });
    await startQueue([song('e'), song('f')], 1);
    nearEnd(5);
    await flush();
    expect(FakeAudio.all.some((a) => a.src.endsWith('/e'))).toBe(true);
  });

  it('starts the pre-loaded track the moment the current one ends — with no waiting', async () => {
    await startQueue([song('a'), song('b')]);
    const first = playing()[0];
    nearEnd(10);
    await flush();
    const second = FakeAudio.all.find((a) => a.src.endsWith('/b'))!;

    first.emit('ended'); // no await: a gapless hand-over must be synchronous

    expect(second.paused).toBe(false);
    expect(first.paused).toBe(true);
    expect(second.currentTime).toBe(0);
    expect(usePlayerStore.getState().currentSong?.id).toBe('b');
  });

  it('only the active element updates the store (the other one is just buffering)', async () => {
    await startQueue([song('a'), song('b')]);
    nearEnd(10);
    await flush();
    const spare = FakeAudio.all.find((a) => a.src.endsWith('/b'))!;

    spare.currentTime = 55;
    spare.emit('timeupdate');
    expect(usePlayerStore.getState().currentTime).not.toBe(55);
  });

  it('plays a track that was not pre-loaded normally (queue jumped)', async () => {
    await startQueue([song('a'), song('b'), song('c')]);
    nearEnd(10); // pre-loads b…
    await flush();
    usePlayerStore.getState().jumpTo(2); // …but the user picks c
    await flush();
    expect(playing().length).toBe(1);
    expect(playing()[0].src.endsWith('/c')).toBe(true);
  });
});

describe('crossfade', () => {
  it('starts the next track early and ramps the two volumes in opposite directions', async () => {
    usePlaybackStore.setState({ crossfadeSec: 4 });
    await startQueue([song('a'), song('b')]);
    const first = playing()[0];
    nearEnd(10);
    await flush();
    const second = FakeAudio.all.find((a) => a.src.endsWith('/b'))!;

    vi.useFakeTimers();
    nearEnd(3.5); // inside the overlap window
    expect(second.paused).toBe(false);
    expect(first.paused).toBe(false); // still fading out
    expect(usePlayerStore.getState().currentSong?.id).toBe('b');

    vi.advanceTimersByTime(2000); // halfway
    expect(second.volume).toBeCloseTo(Math.sin(Math.PI / 4), 1);
    expect(first.volume).toBeCloseTo(Math.cos(Math.PI / 4), 1);

    vi.advanceTimersByTime(2200); // done
    expect(first.paused).toBe(true);
    expect(second.volume).toBeCloseTo(1, 2);
  });

  it('does not cross-fade a track too short to hold the overlap', async () => {
    usePlaybackStore.setState({ crossfadeSec: 12 });
    await startQueue([song('a'), song('b')]);
    const first = playing()[0];
    first.duration = 20; // < 2 × 12 + 1
    first.currentTime = 10;
    first.emit('timeupdate');
    await flush();
    first.currentTime = 19;
    first.emit('timeupdate');
    expect(usePlayerStore.getState().currentSong?.id).toBe('a');
  });

  it('a manual skip during the fade stops it and silences the outgoing track', async () => {
    usePlaybackStore.setState({ crossfadeSec: 6 });
    await startQueue([song('a'), song('b'), song('c')]);
    const first = playing()[0];
    nearEnd(12);
    await flush();

    vi.useFakeTimers();
    nearEnd(5);
    usePlayerStore.getState().next(); // user skips to c mid-fade
    await vi.advanceTimersByTimeAsync(10);

    expect(first.paused).toBe(true);
    expect(playing().length).toBe(1);
    expect(playing()[0].src.endsWith('/c')).toBe(true);
  });

  it('pausing during the fade stops both tracks', async () => {
    usePlaybackStore.setState({ crossfadeSec: 6 });
    await startQueue([song('a'), song('b')]);
    nearEnd(12);
    await flush();
    vi.useFakeTimers();
    nearEnd(5);
    usePlayerStore.getState().togglePlay();
    expect(playing().length).toBe(0);
  });

  it('applies ReplayGain to the incoming track while fading', async () => {
    usePlaybackStore.setState({ crossfadeSec: 4 });
    await startQueue([song('a'), song('b', { replayGainTrackGain: -6 })]);
    nearEnd(10);
    await flush();
    const second = FakeAudio.all.find((a) => a.src.endsWith('/b'))!;
    vi.useFakeTimers();
    nearEnd(3);
    vi.advanceTimersByTime(4500);
    expect(second.volume).toBeCloseTo(Math.pow(10, -6 / 20), 2);
  });
});
