import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Song } from '../api/types';

// player.ts creates a singleton `new Audio()` at module load time, which
// doesn't exist in this project's node test environment — stub a minimal
// fake before importing so the module (and its real store logic) loads.
class FakeAudio {
  /** The one instance loadAndPlay() actually talks to — player.ts creates it
   * once at module load, so tests read state through this static reference
   * rather than needing player.ts to export the audio element itself. */
  static instance: FakeAudio;
  preload = '';
  src = '';
  volume = 1;
  paused = true;
  currentTime = 0;
  duration = 0;
  private listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  constructor() {
    FakeAudio.instance = this;
  }
  addEventListener(type: string, cb: (...a: unknown[]) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: (...a: unknown[]) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }
  /** Fires every listener registered for `type`, e.g. simulating playback
   * crossing the scrobble threshold via a 'timeupdate' event. */
  emit(type: string) {
    for (const l of this.listeners[type] ?? []) l();
  }
  listenerCount(type: string) {
    return (this.listeners[type] ?? []).length;
  }
  /** Set by a test to simulate a browser autoplay-policy rejection. */
  static rejectPlay = false;
  play() {
    if (FakeAudio.rejectPlay) {
      this.paused = true;
      return Promise.reject(new Error('NotAllowedError'));
    }
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
}
vi.stubGlobal('Audio', FakeAudio);
// Only used by the downloaded-track branch of resolvePlaybackUrl(); real
// object-URL creation needs a browser. Extends the real URL (rather than
// replacing the global outright) since other modules in the import graph
// construct real `new URL(...)` instances. Wrapped in vi.fn() so tests can
// assert on create/revoke call counts, not just the (fixed) returned string.
class StubURL extends URL {
  static createObjectURL = vi.fn(() => 'blob:fake');
  static revokeObjectURL = vi.fn();
}
vi.stubGlobal('URL', StubURL);

// Lets the race-condition tests below control exactly when a "downloaded
// track" lookup resolves (and in what order), independent of call order —
// vi.hoisted() so the map exists before vi.mock()'s factory runs.
const { blobResolvers } = vi.hoisted(() => ({
  blobResolvers: {} as Record<string, (v: { blob: Blob; mimeType: string } | null) => void>,
}));
vi.mock('../lib/offlineDb', () => ({
  getTrackAudioBlob: (id: string) =>
    new Promise((resolve) => {
      blobResolvers[id] = resolve;
    }),
}));
vi.mock('../api/subsonic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/subsonic')>()),
  scrobble: vi.fn().mockResolvedValue(undefined),
}));

const { usePlayerStore, remote, currentPlayCounted, effectiveVolume } = await import('./player');
const { useDownloadsStore } = await import('./downloads');
const { scrobble } = await import('../api/subsonic');

/** Drains pending microtasks — loadAndPlay() chains two awaits
 * (resolvePlaybackUrl awaiting getTrackAudioBlob) after a blobResolvers[id]
 * call, so a plain `await Promise.resolve()` isn't reliably enough hops. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function song(id: string): Song {
  return {
    id, title: `Track ${id}`, album: 'Album', albumId: 'al-1', artist: 'Artist', artistId: 'ar-1',
    created: '2024-01-01', isVideo: false, type: 'music',
  };
}

beforeEach(() => {
  usePlayerStore.setState({
    queue: [],
    queueIndex: -1,
    currentSong: null,
    playing: false,
    repeatMode: 'off',
    shuffle: false,
    originalQueue: null,
  });
});

describe('playNext', () => {
  it('inserts immediately after the currently playing track', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b'), song('c')], queueIndex: 0 });
    usePlayerStore.getState().playNext(song('x'));

    const { queue, queueIndex } = usePlayerStore.getState();
    expect(queue.map((s) => s.id)).toEqual(['a', 'x', 'b', 'c']);
    expect(queueIndex).toBe(0); // the current track's position is unaffected
  });

  it('inserts at the start when nothing is currently playing', () => {
    usePlayerStore.setState({ queue: [], queueIndex: -1 });
    usePlayerStore.getState().playNext(song('x'));

    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['x']);
  });

  it('appends at the end when the current track is the last in the queue', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 1 });
    usePlayerStore.getState().playNext(song('x'));

    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['a', 'b', 'x']);
  });

  it('repeated calls stack in most-recent-first order right after the current track', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 0 });
    usePlayerStore.getState().playNext(song('x'));
    usePlayerStore.getState().playNext(song('y'));

    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['a', 'y', 'x', 'b']);
  });
});

describe('addToQueue', () => {
  it('appends to the end regardless of the current position', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 0 });
    usePlayerStore.getState().addToQueue(song('z'));

    const { queue, queueIndex } = usePlayerStore.getState();
    expect(queue.map((s) => s.id)).toEqual(['a', 'b', 'z']);
    expect(queueIndex).toBe(0);
  });
});

describe('toggleRepeat', () => {
  it('cycles off -> all -> one -> off', () => {
    expect(usePlayerStore.getState().repeatMode).toBe('off');
    usePlayerStore.getState().toggleRepeat();
    expect(usePlayerStore.getState().repeatMode).toBe('all');
    usePlayerStore.getState().toggleRepeat();
    expect(usePlayerStore.getState().repeatMode).toBe('one');
    usePlayerStore.getState().toggleRepeat();
    expect(usePlayerStore.getState().repeatMode).toBe('off');
  });
});

describe('next', () => {
  it('stops at the end of the queue when repeat is off', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 1, repeatMode: 'off' });
    usePlayerStore.getState().next();

    const { queueIndex, playing } = usePlayerStore.getState();
    expect(queueIndex).toBe(1);
    expect(playing).toBe(false);
  });

  it('wraps back to the first track when repeat is "all"', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 1, repeatMode: 'all' });
    usePlayerStore.getState().next();

    const { queueIndex, currentSong } = usePlayerStore.getState();
    expect(queueIndex).toBe(0);
    expect(currentSong?.id).toBe('a');
  });

  it('advances normally mid-queue and drops repeat-one to off (manual skip)', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b'), song('c')], queueIndex: 0, repeatMode: 'one' });
    usePlayerStore.getState().next();

    const { queueIndex, currentSong, repeatMode } = usePlayerStore.getState();
    expect(queueIndex).toBe(1);
    expect(currentSong?.id).toBe('b');
    expect(repeatMode).toBe('off');
  });

  it('reshuffles when looping back around with shuffle + repeat-all', () => {
    const queue = [song('a'), song('b'), song('c'), song('d'), song('e')];
    usePlayerStore.setState({ queue, queueIndex: queue.length - 1, repeatMode: 'all', shuffle: true });
    usePlayerStore.getState().next();

    const { queueIndex, queue: newQueue, currentSong } = usePlayerStore.getState();
    expect(queueIndex).toBe(0);
    expect(currentSong?.id).toBe(newQueue[0].id);
    // still the same five songs, just possibly reordered
    expect(newQueue.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('toggleShuffle', () => {
  it('keeps the currently playing song in place and randomizes the rest', () => {
    const queue = [song('a'), song('b'), song('c'), song('d'), song('e')];
    usePlayerStore.setState({ queue, queueIndex: 2, currentSong: song('c') });
    usePlayerStore.getState().toggleShuffle();

    const { queue: shuffled, queueIndex, shuffle, currentSong } = usePlayerStore.getState();
    expect(shuffle).toBe(true);
    expect(queueIndex).toBe(0);
    expect(shuffled[0].id).toBe('c');
    expect(currentSong?.id).toBe('c');
    expect(shuffled.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('restores original order and correct position when turned back off', () => {
    const queue = [song('a'), song('b'), song('c'), song('d'), song('e')];
    usePlayerStore.setState({ queue, queueIndex: 2, currentSong: song('c') });
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().toggleShuffle();

    const { queue: restored, queueIndex, shuffle, originalQueue } = usePlayerStore.getState();
    expect(shuffle).toBe(false);
    expect(originalQueue).toBeNull();
    expect(restored.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(queueIndex).toBe(2);
  });

  it('a new queue started while shuffle is already on is shuffled immediately (works from any view)', () => {
    usePlayerStore.setState({ shuffle: true });
    const songs = [song('x'), song('y'), song('z'), song('w')];
    usePlayerStore.getState().playQueue(songs, 1);

    const { queue, queueIndex, currentSong } = usePlayerStore.getState();
    expect(queueIndex).toBe(0);
    expect(queue[0].id).toBe('y');
    expect(currentSong?.id).toBe('y');
    expect(queue.map((s) => s.id).sort()).toEqual(['w', 'x', 'y', 'z']);
  });
});

describe('repeat-one manual override (Spotify parity)', () => {
  it('prev() drops repeat-one to off', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 1, currentTime: 0, repeatMode: 'one' });
    usePlayerStore.getState().prev();

    expect(usePlayerStore.getState().repeatMode).toBe('off');
  });

  it('prev() drops repeat-one to off even when just restarting the current track (currentTime > 3s)', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 1, currentTime: 10, repeatMode: 'one' });
    usePlayerStore.getState().prev();

    expect(usePlayerStore.getState().repeatMode).toBe('off');
  });

  it('playSong() with a new queue drops repeat-one to off', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 0, repeatMode: 'one' });
    usePlayerStore.getState().playSong(song('c'), [song('a'), song('b'), song('c')]);

    expect(usePlayerStore.getState().repeatMode).toBe('off');
  });

  it('playQueue() drops repeat-one to off', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 0, repeatMode: 'one' });
    usePlayerStore.getState().playQueue([song('x'), song('y')], 0);

    expect(usePlayerStore.getState().repeatMode).toBe('off');
  });

  it('leaves repeat "off" and "all" untouched on manual skip', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 0, repeatMode: 'off' });
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().repeatMode).toBe('off');

    usePlayerStore.setState({ queue: [song('a'), song('b')], queueIndex: 0, repeatMode: 'all' });
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().repeatMode).toBe('all');
  });

  it('the natural end-of-track loop (ended event) does not go through here and repeat-one is untouched by design', () => {
    // toggleRepeat only ever cycles a single enum (off -> all -> one -> off), so
    // "all" and "one" can never be layered together in this store.
    usePlayerStore.getState().toggleRepeat();
    usePlayerStore.getState().toggleRepeat();
    expect(usePlayerStore.getState().repeatMode).toBe('one');
    usePlayerStore.getState().toggleRepeat();
    expect(usePlayerStore.getState().repeatMode).toBe('off');
  });
});

describe('removeFromQueue', () => {
  it('removes a track before the current index and decrements queueIndex to keep pointing at the same song', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b'), song('c')], queueIndex: 2, currentSong: song('c') });
    usePlayerStore.getState().removeFromQueue(0);

    const { queue, queueIndex, currentSong } = usePlayerStore.getState();
    expect(queue.map((s) => s.id)).toEqual(['b', 'c']);
    expect(queueIndex).toBe(1); // still pointing at 'c'
    expect(currentSong?.id).toBe('c'); // untouched — only the currently-playing track's own removal clears it
  });

  it('removes a track after the current index without moving queueIndex', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b'), song('c')], queueIndex: 0 });
    usePlayerStore.getState().removeFromQueue(2);

    const { queue, queueIndex } = usePlayerStore.getState();
    expect(queue.map((s) => s.id)).toEqual(['a', 'b']);
    expect(queueIndex).toBe(0);
  });

  it('removing the currently playing track clears playback and stops the audio element', () => {
    usePlayerStore.setState({
      queue: [song('a'), song('b'), song('c')], queueIndex: 1, currentSong: song('b'), playing: true,
    });
    FakeAudio.instance.paused = false;
    usePlayerStore.getState().removeFromQueue(1);

    const { queue, queueIndex, currentSong, playing } = usePlayerStore.getState();
    expect(queue.map((s) => s.id)).toEqual(['a', 'c']);
    expect(queueIndex).toBe(-1);
    expect(currentSong).toBeNull();
    expect(playing).toBe(false);
    expect(FakeAudio.instance.paused).toBe(true);
  });

  it('also removes the matching entry from originalQueue (shuffle active)', () => {
    const a = song('a'); const b = song('b'); const c = song('c');
    usePlayerStore.setState({ queue: [a, b, c], queueIndex: 0, originalQueue: [c, a, b] });
    usePlayerStore.getState().removeFromQueue(2); // removes 'c' from the (shuffled) queue

    expect(usePlayerStore.getState().originalQueue?.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('reorderQueue', () => {
  it('branch: moving the currently-playing track itself — queueIndex follows it to `to`', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b'), song('c'), song('d')], queueIndex: 1 });
    usePlayerStore.getState().reorderQueue(1, 3);

    const { queue, queueIndex } = usePlayerStore.getState();
    expect(queue.map((s) => s.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(queueIndex).toBe(3);
    expect(queue[queueIndex].id).toBe('b');
  });

  it('branch: a track moves from before to at-or-past the current index — queueIndex shifts down by one', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b'), song('c'), song('d')], queueIndex: 2 });
    usePlayerStore.getState().reorderQueue(0, 2);

    const { queue, queueIndex } = usePlayerStore.getState();
    expect(queue.map((s) => s.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(queueIndex).toBe(1);
    expect(queue[queueIndex].id).toBe('c'); // still points at the same song
  });

  it('branch: a track moves from after to at-or-before the current index — queueIndex shifts up by one', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b'), song('c'), song('d')], queueIndex: 1 });
    usePlayerStore.getState().reorderQueue(3, 0);

    const { queue, queueIndex } = usePlayerStore.getState();
    expect(queue.map((s) => s.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(queueIndex).toBe(2);
    expect(queue[queueIndex].id).toBe('b'); // still points at the same song
  });

  it('a reorder entirely on one side of the current index leaves queueIndex untouched', () => {
    usePlayerStore.setState({ queue: [song('a'), song('b'), song('c'), song('d')], queueIndex: 2 });
    usePlayerStore.getState().reorderQueue(0, 1);

    const { queue, queueIndex } = usePlayerStore.getState();
    expect(queue.map((s) => s.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(queueIndex).toBe(2);
    expect(queue[queueIndex].id).toBe('c'); // still points at the same song
  });
});

describe('clearQueue', () => {
  it('empties the queue, resets position and current song, and pauses the audio element', () => {
    usePlayerStore.setState({
      queue: [song('a'), song('b')], queueIndex: 1, currentSong: song('b'), playing: true,
      originalQueue: [song('b'), song('a')],
    });
    FakeAudio.instance.paused = false;
    usePlayerStore.getState().clearQueue();

    const { queue, queueIndex, currentSong, playing, originalQueue } = usePlayerStore.getState();
    expect(queue).toEqual([]);
    expect(queueIndex).toBe(-1);
    expect(currentSong).toBeNull();
    expect(playing).toBe(false);
    expect(originalQueue).toBeNull();
    expect(FakeAudio.instance.paused).toBe(true);
  });
});

describe('seek', () => {
  it('updates both the audio element and the store currentTime', () => {
    usePlayerStore.getState().seek(42.5);

    expect(FakeAudio.instance.currentTime).toBe(42.5);
    expect(usePlayerStore.getState().currentTime).toBe(42.5);
  });
});

describe('setVolume', () => {
  it('updates both the audio element and the store volume', () => {
    usePlayerStore.getState().setVolume(0.3);

    expect(FakeAudio.instance.volume).toBe(0.3);
    expect(usePlayerStore.getState().volume).toBe(0.3);
  });
});

describe('toggleMute', () => {
  it('mutes to 0 and restores the previous volume on toggle back', () => {
    usePlayerStore.getState().setVolume(0.7);

    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().volume).toBe(0);
    expect(FakeAudio.instance.volume).toBe(0);

    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().volume).toBe(0.7);
    expect(FakeAudio.instance.volume).toBe(0.7);
  });

  it('unmuting after volume was already 0 (no prior mute) restores to full volume', () => {
    usePlayerStore.getState().setVolume(0);

    usePlayerStore.getState().toggleMute();

    expect(usePlayerStore.getState().volume).toBe(1);
  });
});

describe('loadAndPlay async behavior (#49)', () => {
  beforeEach(() => {
    useDownloadsStore.setState({ status: {} });
    FakeAudio.rejectPlay = false;
    StubURL.createObjectURL.mockClear();
    StubURL.revokeObjectURL.mockClear();
  });

  it('applies ReplayGain track gain, converting dB to a linear volume scalar', async () => {
    usePlayerStore.setState({ volume: 0.5 });
    const a: Song = { ...song('a'), replayGainTrackGain: -6 };
    usePlayerStore.getState().playSong(a, [a]);
    await flush();

    expect(FakeAudio.instance.volume).toBeCloseTo(0.5 * Math.pow(10, -6 / 20), 5);
  });

  it('clamps a ReplayGain-boosted volume at 1 rather than exceeding it', async () => {
    usePlayerStore.setState({ volume: 1 });
    const a: Song = { ...song('a'), replayGainTrackGain: 12 };
    usePlayerStore.getState().playSong(a, [a]);
    await flush();

    expect(FakeAudio.instance.volume).toBe(1);
  });

  it('uses the plain user volume for a track with no ReplayGain tag', async () => {
    usePlayerStore.setState({ volume: 0.7 });
    usePlayerStore.getState().playSong(song('a'), [song('a')]);
    await flush();

    expect(FakeAudio.instance.volume).toBe(0.7);
  });

  it('does not create or revoke any object URL when playing a streamed (non-downloaded) track', async () => {
    usePlayerStore.getState().playSong(song('a'), [song('a')]);
    await flush();

    expect(StubURL.createObjectURL).not.toHaveBeenCalled();
    expect(StubURL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes the previous object URL exactly once when switching between two downloaded tracks', async () => {
    useDownloadsStore.setState({ status: { 't:a': 'downloaded', 't:b': 'downloaded' } });
    const a = song('a'); const b = song('b');

    // The real browser API returns a distinct string per call; give the stub
    // the same property so `audio.src !== url` actually detects the switch
    // (the mock otherwise always returns the same fixed string).
    StubURL.createObjectURL.mockReturnValueOnce('blob:fake-a');
    usePlayerStore.getState().playSong(a, [a, b]);
    blobResolvers['a']({ blob: {} as Blob, mimeType: 'audio/mpeg' });
    await flush();
    expect(StubURL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(StubURL.revokeObjectURL).not.toHaveBeenCalled(); // nothing to revoke on the first track

    StubURL.createObjectURL.mockReturnValueOnce('blob:fake-b');
    usePlayerStore.getState().playSong(b, [a, b]);
    blobResolvers['b']({ blob: {} as Blob, mimeType: 'audio/mpeg' });
    await flush();
    expect(StubURL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(StubURL.revokeObjectURL).toHaveBeenCalledTimes(1); // a's URL, released on switching to b
    expect(StubURL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-a');
  });

  it('does not throw synchronously or leave an unhandled rejection when audio.play() rejects (autoplay policy)', async () => {
    FakeAudio.rejectPlay = true;
    expect(() => usePlayerStore.getState().playSong(song('a'), [song('a')])).not.toThrow();
    await flush();
    // If loadAndPlay's `.catch()` on audio.play() were removed, the rejected
    // promise above would surface as an unhandled rejection and fail this test.
  });
});

describe('loadAndPlay race conditions (#35 / #36)', () => {
  beforeEach(() => {
    useDownloadsStore.setState({ status: { 't:a': 'downloaded', 't:b': 'downloaded' } });
  });

  it('a slower, stale URL resolution does not override a track loaded after it (#36)', async () => {
    const a = song('a');
    const b = song('b');

    usePlayerStore.getState().playSong(a, [a, b]); // starts resolving a's URL
    usePlayerStore.getState().playSong(b, [a, b]); // supersedes it before a resolves

    // Resolve the newer call (b) first, then the stale one (a) — the
    // reverse of call order, simulating a's lookup finishing last.
    blobResolvers['b']({ blob: {} as Blob, mimeType: 'audio/mpeg' });
    await flush();
    expect(FakeAudio.instance.src).toBe('blob:fake'); // b applied

    blobResolvers['a']({ blob: {} as Blob, mimeType: 'audio/mpeg' });
    await flush();
    // a's stale resolution must not have reverted playback
    expect(FakeAudio.instance.src).toBe('blob:fake');
    expect(usePlayerStore.getState().currentSong?.id).toBe('b');
  });

  it('replaces (never stacks) the scrobble-threshold listener when skipped before it fires (#35)', async () => {
    const a = song('a');
    const b = song('b');

    usePlayerStore.getState().playSong(a, [a, b]);
    blobResolvers['a']({ blob: {} as Blob, mimeType: 'audio/mpeg' });
    await flush();
    const afterA = FakeAudio.instance.listenerCount('timeupdate');

    // Skip to b before a's scrobble threshold (30s / 50%) is ever reached.
    usePlayerStore.getState().playSong(b, [a, b]);
    blobResolvers['b']({ blob: {} as Blob, mimeType: 'audio/mpeg' });
    await flush();
    const afterB = FakeAudio.instance.listenerCount('timeupdate');

    // Same count, not +1 — a's stale listener was removed, not left dangling.
    expect(afterB).toBe(afterA);

    // Cross the threshold: only b (the actually-playing track) may scrobble.
    FakeAudio.instance.currentTime = 31;
    FakeAudio.instance.duration = 200;
    FakeAudio.instance.emit('timeupdate');

    expect(scrobble).toHaveBeenCalledWith('b', true);
    expect(scrobble).not.toHaveBeenCalledWith('a', true);
  });
});

describe('remote control hook (Connect)', () => {
  const command = vi.fn();
  const setVolume = vi.fn();
  const queueAdd = vi.fn();
  const queueRemove = vi.fn();
  const queueMove = vi.fn();
  let isRemote = true;

  beforeEach(() => {
    FakeAudio.rejectPlay = false;
    useDownloadsStore.setState({ status: {} });
    [command, setVolume, queueAdd, queueRemove, queueMove].forEach((m) => m.mockClear());
    isRemote = true;
    remote.current = { isRemote: () => isRemote, command, setVolume, volume: () => 0.5, queueAdd, queueRemove, queueMove };
    FakeAudio.instance.paused = true;
    FakeAudio.instance.currentTime = 0;
  });
  afterEach(() => {
    remote.current = null;
  });

  it('togglePlay sends pause while the remote is playing and play while it is paused, leaving the local audio alone', () => {
    usePlayerStore.setState({ playing: true });
    usePlayerStore.getState().togglePlay();
    usePlayerStore.setState({ playing: false });
    usePlayerStore.getState().togglePlay();

    expect(command.mock.calls).toEqual([['pause'], ['play']]);
    expect(FakeAudio.instance.paused).toBe(true);
  });

  it('next and prev become commands without touching the local queue', () => {
    const a = song('r-a');
    const b = song('r-b');
    usePlayerStore.setState({ queue: [a, b], queueIndex: 0, currentSong: a });

    usePlayerStore.getState().next();
    usePlayerStore.getState().prev();

    expect(command.mock.calls).toEqual([['next'], ['previous']]);
    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });

  it('seek sends the position in milliseconds and shows it straight away without moving the local audio', () => {
    usePlayerStore.getState().seek(42.5);

    expect(command).toHaveBeenCalledWith('seek', 42_500);
    expect(usePlayerStore.getState().currentTime).toBe(42.5);
    expect(FakeAudio.instance.currentTime).toBe(0);
  });

  it('volume and mute drive the other device and leave this device\'s audio alone', () => {
    usePlayerStore.setState({ volume: 0.9 });
    FakeAudio.instance.volume = 0.9;

    usePlayerStore.getState().setVolume(0.2);
    expect(setVolume).toHaveBeenLastCalledWith(0.2);
    expect(usePlayerStore.getState().volume).toBe(0.9);
    expect(FakeAudio.instance.volume).toBe(0.9);

    usePlayerStore.getState().toggleMute(); // the other device is at 0.5 (see the stub)
    expect(setVolume).toHaveBeenLastCalledWith(0);
    expect(FakeAudio.instance.volume).toBe(0.9);
  });

  it('effectiveVolume is the other device\'s while remote and this device\'s otherwise', () => {
    usePlayerStore.setState({ volume: 0.9 });
    expect(effectiveVolume()).toBe(0.5);
    isRemote = false;
    expect(effectiveVolume()).toBe(0.9);
  });

  it('play next, add to queue, remove and reorder go to the other device, not this device\'s queue', () => {
    const a = song('r-a');
    const b = song('r-b');
    usePlayerStore.setState({ queue: [], queueIndex: -1 });

    usePlayerStore.getState().playNext(a);
    usePlayerStore.getState().addToQueue(b);
    usePlayerStore.getState().removeFromQueue(2);
    usePlayerStore.getState().reorderQueue(1, 3);

    expect(queueAdd.mock.calls).toEqual([[a, 'next'], [b, 'end']]);
    expect(queueRemove).toHaveBeenCalledWith(2);
    expect(queueMove).toHaveBeenCalledWith(1, 3);
    expect(usePlayerStore.getState().queue).toEqual([]);
  });

  it('volume and queue edits act locally as usual when this device is the player', () => {
    isRemote = false;
    const a = song('r-a');
    const b = song('r-b');
    usePlayerStore.setState({ queue: [a], queueIndex: 0, currentSong: a });

    usePlayerStore.getState().setVolume(0.3);
    usePlayerStore.getState().addToQueue(b);
    usePlayerStore.getState().playNext(song('r-c'));

    expect(setVolume).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().volume).toBe(0.3);
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['r-a', 'r-c', 'r-b']);
  });

  it('jumpTo plays a song of the queue and leaves the queue and its shuffle backup alone', () => {
    const q = ['j-a', 'j-b', 'j-c'].map((id) => song(id));
    usePlayerStore.setState({ queue: q, queueIndex: 0, currentSong: q[0], shuffle: true, originalQueue: [...q].reverse(), repeatMode: 'one' });

    usePlayerStore.getState().jumpTo(2);
    expect(usePlayerStore.getState().currentSong?.id).toBe('j-c');
    expect(usePlayerStore.getState().queueIndex).toBe(2);
    expect(usePlayerStore.getState().queue).toBe(q);
    expect(usePlayerStore.getState().originalQueue?.map((s) => s.id)).toEqual(['j-c', 'j-b', 'j-a']);
    expect(usePlayerStore.getState().repeatMode).toBe('off'); // picking a track drops repeat-one, like every manual pick

    usePlayerStore.getState().jumpTo(9);
    expect(usePlayerStore.getState().queueIndex).toBe(2);
  });

  it('acts locally as usual when this device is not just a remote', () => {
    isRemote = false;
    const a = song('r-a');
    const b = song('r-b');
    usePlayerStore.setState({ queue: [a, b], queueIndex: 0, currentSong: a });

    usePlayerStore.getState().next();
    usePlayerStore.getState().seek(10);
    usePlayerStore.getState().togglePlay();

    expect(command).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queueIndex).toBe(1);
    expect(FakeAudio.instance.currentTime).toBe(10);
    expect(FakeAudio.instance.paused).toBe(false);
  });

  it('playing something locally is never forwarded: it takes over', () => {
    const a = song('r-a');
    usePlayerStore.getState().playQueue([a], 0);

    expect(command).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentSong?.id).toBe('r-a');
  });
});

describe('restoreQueue and pauseLocal (Connect handover)', () => {
  // distinct ids: earlier tests above leave 'a'/'b' marked as downloaded, which would stall loading
  const [a, b, c] = ['r-a', 'r-b', 'r-c'].map(song);

  beforeEach(() => {
    FakeAudio.rejectPlay = false;
    useDownloadsStore.setState({ status: {} });
  });

  it('loads the queue at the given index and shows the position, without any shuffle bookkeeping', async () => {
    usePlayerStore.getState().restoreQueue([a, b, c], 1, 83_500, true);
    await flush();

    const s = usePlayerStore.getState();
    expect(s.queue.map((x) => x.id)).toEqual(['r-a', 'r-b', 'r-c']);
    expect(s.queueIndex).toBe(1);
    expect(s.currentSong?.id).toBe('r-b');
    expect(s.currentTime).toBe(83.5);
    expect(s.originalQueue).toBeNull();
  });

  it('starts playback and seeks to the position once the track\'s metadata is available', async () => {
    FakeAudio.instance.paused = true;
    usePlayerStore.getState().restoreQueue([a, b], 0, 12_000, true);
    await flush();

    expect(FakeAudio.instance.paused).toBe(false);
    expect(FakeAudio.instance.currentTime).not.toBe(12);
    FakeAudio.instance.emit('loadedmetadata');
    expect(FakeAudio.instance.currentTime).toBe(12);
  });

  it('with play=false it loads and positions the track but leaves it paused, and sends no "now playing"', async () => {
    FakeAudio.instance.paused = true;
    vi.mocked(scrobble).mockClear();

    usePlayerStore.getState().restoreQueue([a], 0, 5_000, false);
    await flush();

    expect(FakeAudio.instance.paused).toBe(true);
    expect(scrobble).not.toHaveBeenCalled();
  });

  it('a play that the other device already counted is not counted again here', async () => {
    vi.mocked(scrobble).mockClear();
    usePlayerStore.getState().restoreQueue([a], 0, 40_000, true, true);
    await flush();
    FakeAudio.instance.currentTime = 90;
    FakeAudio.instance.duration = 200;
    FakeAudio.instance.emit('timeupdate');

    expect(scrobble).not.toHaveBeenCalledWith('r-a', true);
    expect(currentPlayCounted()).toBe(true);
  });

  it('an uncounted play is counted once it passes the threshold, and then reports itself as counted', async () => {
    vi.mocked(scrobble).mockClear();
    usePlayerStore.getState().restoreQueue([a], 0, 0, true, false);
    await flush();
    expect(currentPlayCounted()).toBe(false);

    FakeAudio.instance.currentTime = 31;
    FakeAudio.instance.duration = 200;
    FakeAudio.instance.emit('timeupdate');

    expect(scrobble).toHaveBeenCalledWith('r-a', true);
    expect(currentPlayCounted()).toBe(true);
  });

  it('clamps an out-of-range index and ignores an empty queue', async () => {
    usePlayerStore.getState().restoreQueue([a, b], 99, 0, false);
    await flush();
    expect(usePlayerStore.getState().queueIndex).toBe(1);

    usePlayerStore.setState({ queue: [], queueIndex: -1, currentSong: null });
    usePlayerStore.getState().restoreQueue([], 0, 0, true);
    expect(usePlayerStore.getState().currentSong).toBeNull();
  });

  it('pauseLocal silences the audio and leaves the queue alone', () => {
    usePlayerStore.setState({ queue: [a, b], queueIndex: 0, currentSong: a });
    FakeAudio.instance.paused = false;

    usePlayerStore.getState().pauseLocal();

    expect(FakeAudio.instance.paused).toBe(true);
    expect(usePlayerStore.getState().queue).toHaveLength(2);
  });
});
