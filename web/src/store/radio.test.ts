// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Song } from '../api/types';

// player.ts needs an Audio element; a tiny stand-in is enough (nothing is played here).
class FakeAudio {
  preload = ''; src = ''; volume = 1; paused = true; currentTime = 0; duration = 0; readyState = 4;
  addEventListener() {}
  removeEventListener() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
}
vi.stubGlobal('Audio', FakeAudio);
vi.mock('../lib/offlineDb', () => ({ getTrackAudioBlob: () => Promise.resolve(null) }));
vi.mock('../api/subsonic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/subsonic')>()),
  scrobble: vi.fn().mockResolvedValue(undefined),
  streamUrl: (id: string) => `http://server/stream/${id}`,
  getRadio: vi.fn(),
}));

const { usePlayerStore } = await import('./player');
const { useRadioStore } = await import('./radio');
const { useToastStore } = await import('./toast');
const subsonic = await import('../api/subsonic');
const getRadio = vi.mocked(subsonic.getRadio);

const song = (id: string): Song => ({
  id, title: `Song ${id}`, album: 'Al', albumId: 'al', artist: 'Ar', artistId: 'ar',
  created: '2024-01-01', isVideo: false, type: 'music',
});
const songs = (from: number, n: number) => Array.from({ length: n }, (_, i) => song(String(from + i)));
const flush = () => new Promise((r) => setTimeout(r, 0));
const seed = { type: 'song' as const, id: 's0', name: 'Seed song' };

beforeEach(() => {
  getRadio.mockReset();
  useRadioStore.getState().stop();
  usePlayerStore.setState({ queue: [], queueIndex: -1, currentSong: null, playing: false, repeatMode: 'off', shuffle: false, originalQueue: null });
  useToastStore.setState({ message: null });
});

describe('radio', () => {
  it('starts with the seed song first, then the server\'s picks', async () => {
    getRadio.mockResolvedValue(songs(1, 30));
    await useRadioStore.getState().start(seed, song('s0'));

    expect(getRadio).toHaveBeenCalledWith('song', 's0', 30, ['s0']);
    const { queue, queueIndex } = usePlayerStore.getState();
    expect(queue[0].id).toBe('s0');
    expect(queue).toHaveLength(31);
    expect(queueIndex).toBe(0);
    expect(useRadioStore.getState().seed).toEqual(seed);
  });

  it('never queues the seed twice', async () => {
    getRadio.mockResolvedValue([song('s0'), song('1')]);
    await useRadioStore.getState().start(seed, song('s0'));
    expect(usePlayerStore.getState().queue.map((s) => s.id)).toEqual(['s0', '1']);
  });

  it('an artist / album / playlist radio has no first song of its own', async () => {
    getRadio.mockResolvedValue(songs(1, 30));
    await useRadioStore.getState().start({ type: 'artist', id: 'a1', name: 'Band' });
    expect(getRadio).toHaveBeenCalledWith('artist', 'a1', 30, []);
    expect(usePlayerStore.getState().queue).toHaveLength(30);
  });

  it('says so, and does not start, when there is nothing to play', async () => {
    getRadio.mockResolvedValue([]);
    await useRadioStore.getState().start(seed, undefined);
    expect(useRadioStore.getState().seed).toBeNull();
    expect(useToastStore.getState().message).toMatch(/isn’t enough music/);
    expect(usePlayerStore.getState().queue).toHaveLength(0);
  });

  it('reports a failure instead of throwing', async () => {
    getRadio.mockRejectedValue(new Error('offline'));
    await useRadioStore.getState().start(seed, song('s0'));
    expect(useToastStore.getState().message).toBe("Couldn't start the radio: offline");
    expect(useRadioStore.getState().seed).toBeNull();
  });

  it('tops the queue up when only a few songs are left, telling the server what is queued', async () => {
    getRadio.mockResolvedValueOnce(songs(1, 12)); // 13 in the queue
    await useRadioStore.getState().start(seed, song('s0'));
    getRadio.mockResolvedValueOnce(songs(100, 5));

    usePlayerStore.setState({ queueIndex: 9, currentSong: usePlayerStore.getState().queue[9] }); // 3 left
    await flush();

    expect(getRadio).toHaveBeenLastCalledWith('song', 's0', 30, expect.arrayContaining(['s0', '1', '12']));
    expect(usePlayerStore.getState().queue).toHaveLength(18);
  });

  it('does not refill while plenty is still queued', async () => {
    getRadio.mockResolvedValueOnce(songs(1, 30));
    await useRadioStore.getState().start(seed, song('s0'));
    usePlayerStore.setState({ queueIndex: 3, currentSong: usePlayerStore.getState().queue[3] });
    await flush();
    expect(getRadio).toHaveBeenCalledTimes(1);
  });

  it('switches itself off when the user plays something else', async () => {
    getRadio.mockResolvedValueOnce(songs(1, 30));
    await useRadioStore.getState().start(seed, song('s0'));
    usePlayerStore.getState().playQueue([song('x1'), song('x2')]);
    await flush();
    expect(useRadioStore.getState().seed).toBeNull();
    expect(getRadio).toHaveBeenCalledTimes(1);
  });

  it('switches off when the queue is cleared; stop() ends it at once', async () => {
    getRadio.mockResolvedValue(songs(1, 30));
    await useRadioStore.getState().start(seed, song('s0'));
    usePlayerStore.getState().clearQueue();
    await flush();
    expect(useRadioStore.getState().seed).toBeNull();

    await useRadioStore.getState().start(seed, song('s0'));
    useRadioStore.getState().stop();
    expect(useRadioStore.getState().seed).toBeNull();
  });

  it('a refill that finishes after the radio was stopped adds nothing', async () => {
    getRadio.mockResolvedValueOnce(songs(1, 8));
    await useRadioStore.getState().start(seed, song('s0'));
    let release!: (s: Song[]) => void;
    getRadio.mockReturnValueOnce(new Promise<Song[]>((r) => { release = r; }));
    usePlayerStore.setState({ queueIndex: 6, currentSong: usePlayerStore.getState().queue[6] });
    await flush();
    useRadioStore.getState().stop();
    const before = usePlayerStore.getState().queue.length;
    release(songs(200, 5));
    await flush();
    expect(usePlayerStore.getState().queue).toHaveLength(before);
  });
});
