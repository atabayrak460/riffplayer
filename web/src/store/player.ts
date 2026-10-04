import { create } from 'zustand';
import { scrobble, streamUrl } from '../api/subsonic';
import { useDownloadsStore } from './downloads';
import { getTrackAudioBlob } from '../lib/offlineDb';
import type { Song } from '../api/types';

// Singleton Audio element — lives outside React's render cycle
const audio = new Audio();
audio.preload = 'metadata';

// Tracks the blob: URL currently assigned to `audio.src` (if any) so it can be
// revoked when playback moves to a different track — object URLs otherwise leak.
let currentObjectUrl: string | null = null;

// Incremented on every loadAndPlay() call. resolvePlaybackUrl() has variable
// latency (IndexedDB lookup for a downloaded track vs. near-synchronous for a
// streamed one), so a rapid skip can let an older, slower call resolve after
// a newer one already took over — checking this after the await lets a
// superseded call detect that and bail out instead of reverting audio.src.
let loadGeneration = 0;

// Detaches the scrobble-threshold `timeupdate` listener installed by the
// most recent loadAndPlay() call that actually started playback, if it
// hasn't fired yet. Replaced (never left dangling) on every track change —
// otherwise a listener from a track skipped before its threshold stays
// attached to the singleton audio element forever, and can later fire
// scrobble() against whatever unrelated track happens to be playing then.
let removeScrobbleListener: (() => void) | null = null;

// Volume to restore on unmute — set right before setVolume(0) in toggleMute(),
// so a manual drag to 0 on the slider doesn't count as "muted" with nothing
// to restore to.
let volumeBeforeMute: number | null = null;

/**
 * Hook for RiffPlayer Connect. While another device is the one playing, this device is only a remote:
 * the transport actions below hand over to the controller instead of driving the local <audio>.
 * (A registry rather than an import so this store doesn't depend on the connect store.)
 */
export interface RemoteController {
  isRemote(): boolean;
  command(type: 'play' | 'pause' | 'next' | 'previous' | 'seek', positionMs?: number): void;
  /** Phase 2: the other device's volume and queue. `index` is the position in the queue as this device shows it. */
  setVolume(volume: number): void;
  /** The other device's volume (1 if it hasn't said). */
  volume(): number;
  queueAdd(song: Song, mode: 'next' | 'end'): void;
  queueRemove(index: number): void;
  queueMove(from: number, to: number): void;
}
export const remote: { current: RemoteController | null } = { current: null };

/** The volume the user is adjusting right now: the other device's while it is the one playing, else this device's. */
export function effectiveVolume(): number {
  const r = remote.current;
  return r?.isRemote() ? r.volume() : usePlayerStore.getState().volume;
}

// Whether the track now loaded has already been counted as a play (scrobbled). Connect hands this to
// the device that takes over, so a transfer mid-song doesn't count the same listen twice.
let currentCounted = false;
export function currentPlayCounted(): boolean {
  return currentCounted;
}

/** Prefer a locally downloaded copy so offline-played tracks need no network. */
async function resolvePlaybackUrl(song: Song): Promise<string> {
  if (useDownloadsStore.getState().trackState(song.id) === 'downloaded') {
    const local = await getTrackAudioBlob(song.id);
    if (local) return URL.createObjectURL(local.blob);
  }
  return streamUrl(song.id);
}

/** Fisher-Yates shuffle — returns a new array, does not mutate the input. */
function shuffleArray<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shuffles `songs`, pinning the song at `keepIndex` to the front so it keeps playing. */
function buildShuffledQueue(songs: Song[], keepIndex: number): Song[] {
  if (!songs.length) return songs;
  const keep = songs[keepIndex] ?? songs[0];
  const rest = songs.filter((_, i) => i !== (keepIndex === -1 ? 0 : keepIndex));
  return [keep, ...shuffleArray(rest)];
}

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  queue: Song[];
  queueIndex: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  // Pre-shuffle order of the current queue, so shuffle can be turned off cleanly. Null when shuffle is off.
  originalQueue: Song[] | null;

  // Derived
  currentSong: Song | null;

  // Actions
  playSong: (song: Song, queue?: Song[]) => void;
  playQueue: (songs: Song[], index?: number) => void;
  /** Jump to a song already in the queue, keeping the queue (and shuffle order) as it is. */
  jumpTo: (index: number) => void;
  /** Loads a queue at a position (used when playback is handed over from another device). */
  restoreQueue: (songs: Song[], index: number, positionMs: number, play: boolean, counted?: boolean) => void;
  /** Silences the local audio element without touching the queue. */
  pauseLocal: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  playNext: (song: Song) => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
}

export const usePlayerStore = create<PlayerState>()((set, get) => {
  // Sync audio events back into store
  audio.addEventListener('timeupdate', () => {
    set({ currentTime: audio.currentTime });
  });
  audio.addEventListener('durationchange', () => {
    set({ duration: audio.duration || 0 });
  });
  audio.addEventListener('ended', () => {
    const { repeatMode, currentSong } = get();
    if (repeatMode === 'one' && currentSong) {
      audio.currentTime = 0;
      audio.play().catch(() => {/* autoplay policy */});
      return;
    }
    get().next();
  });
  audio.addEventListener('play', () => set({ playing: true }));
  audio.addEventListener('pause', () => set({ playing: false }));

  async function loadAndPlay(
    song: Song,
    opts: { startAt?: number; autoplay?: boolean; counted?: boolean } = {},
  ): Promise<void> {
    const generation = ++loadGeneration;
    const autoplay = opts.autoplay !== false;
    currentCounted = opts.counted === true;
    const url = await resolvePlaybackUrl(song);
    if (generation !== loadGeneration) return; // a newer loadAndPlay() call already took over

    if (audio.src !== url) {
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
      }
      audio.src = url;
      if (url.startsWith('blob:')) currentObjectUrl = url;
      audio.load();
    }

    // Apply ReplayGain track gain: convert dB → linear and scale user volume
    const { volume: userVol } = get();
    if (song.replayGainTrackGain != null) {
      const gain = Math.pow(10, song.replayGainTrackGain / 20);
      audio.volume = Math.min(1, Math.max(0, userVol * gain));
    } else {
      audio.volume = userVol;
    }

    if (opts.startAt && opts.startAt > 0) {
      const startAt = opts.startAt;
      if (audio.readyState >= 1) audio.currentTime = startAt;
      else audio.addEventListener('loadedmetadata', () => { audio.currentTime = startAt; }, { once: true });
    }
    if (autoplay) {
      audio.play().catch(() => {/* autoplay policy */});
      scrobble(song.id, false).catch(() => {/* best-effort */});
    } else {
      audio.pause();
    }

    // Scrobble submission after 30 s or 50% played (whichever first). Replace
    // any listener left over from a track skipped before its own threshold
    // fired, so at most one is ever attached and it always matches this track.
    removeScrobbleListener?.();
    // A play handed over from another device that already counted it must not be counted again.
    let scrobbled = opts.counted === true;
    const onTime = () => {
      if (!scrobbled && audio.currentTime >= Math.min(30, (audio.duration || 60) * 0.5)) {
        scrobbled = true;
        currentCounted = true;
        scrobble(song.id, true).catch(() => {});
        audio.removeEventListener('timeupdate', onTime);
        removeScrobbleListener = null;
      }
    };
    audio.addEventListener('timeupdate', onTime);
    removeScrobbleListener = () => audio.removeEventListener('timeupdate', onTime);

    // Media Session API
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album,
      });
    }
  }

  return {
    queue: [],
    queueIndex: -1,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    repeatMode: 'off',
    shuffle: false,
    originalQueue: null,
    currentSong: null,

    playSong: (song, queue) => {
      const q = queue ?? [song];
      const idx = queue ? queue.findIndex((s) => s.id === song.id) : 0;
      // Manually picking a track always drops repeat-one — it only survives the track's own natural loop.
      const repeatMode = get().repeatMode === 'one' ? 'off' : get().repeatMode;
      if (get().shuffle) {
        const shuffled = buildShuffledQueue(q, idx);
        set({ queue: shuffled, queueIndex: 0, currentSong: song, originalQueue: q, repeatMode });
      } else {
        set({ queue: q, queueIndex: idx, currentSong: song, originalQueue: null, repeatMode });
      }
      loadAndPlay(song);
    },

    playQueue: (songs, index = 0) => {
      if (!songs.length) return;
      const song = songs[index];
      const repeatMode = get().repeatMode === 'one' ? 'off' : get().repeatMode;
      if (get().shuffle) {
        const shuffled = buildShuffledQueue(songs, index);
        set({ queue: shuffled, queueIndex: 0, currentSong: song, originalQueue: songs, repeatMode });
      } else {
        set({ queue: songs, queueIndex: index, currentSong: song, originalQueue: null, repeatMode });
      }
      loadAndPlay(song);
    },

    jumpTo: (index) => {
      const song = get().queue[index];
      if (!song) return;
      const repeatMode = get().repeatMode === 'one' ? 'off' : get().repeatMode;
      set({ queueIndex: index, currentSong: song, repeatMode });
      loadAndPlay(song);
    },

    restoreQueue: (songs, index, positionMs, play, counted = false) => {
      if (!songs.length) return;
      const i = Math.min(Math.max(index, 0), songs.length - 1);
      const song = songs[i];
      set({ queue: songs, queueIndex: i, currentSong: song, originalQueue: null, currentTime: positionMs / 1000 });
      loadAndPlay(song, { startAt: positionMs / 1000, autoplay: play, counted });
    },

    pauseLocal: () => {
      audio.pause();
    },

    togglePlay: () => {
      const r = remote.current;
      if (r?.isRemote()) {
        r.command(get().playing ? 'pause' : 'play');
        return;
      }
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    },

    next: () => {
      const r = remote.current;
      if (r?.isRemote()) {
        r.command('next');
        return;
      }
      const { queue, queueIndex, shuffle } = get();
      if (!queue.length) return;
      // A manual skip always drops repeat-one — it only survives the track's own natural loop
      // (which never reaches here — see the `ended` listener above).
      if (get().repeatMode === 'one') set({ repeatMode: 'off' });
      const repeatMode = get().repeatMode;
      let next = queueIndex + 1;
      if (next >= queue.length) {
        if (repeatMode !== 'all') {
          audio.pause();
          set({ playing: false, currentTime: 0 });
          return;
        }
        // Looping back to the start of a shuffled queue — reshuffle for the new lap.
        if (shuffle) {
          const reshuffled = shuffleArray(queue);
          const song = reshuffled[0];
          set({ queue: reshuffled, queueIndex: 0, currentSong: song });
          loadAndPlay(song);
          return;
        }
        next = 0;
      }
      const song = queue[next];
      set({ queueIndex: next, currentSong: song });
      loadAndPlay(song);
    },

    prev: () => {
      const r = remote.current;
      if (r?.isRemote()) {
        r.command('previous');
        return;
      }
      const { queue, queueIndex, currentTime } = get();
      // A manual skip always drops repeat-one — it only survives the track's own natural loop.
      if (get().repeatMode === 'one') set({ repeatMode: 'off' });
      if (currentTime > 3) {
        audio.currentTime = 0;
        return;
      }
      const prev = queueIndex - 1;
      if (prev < 0) { audio.currentTime = 0; return; }
      const song = queue[prev];
      set({ queueIndex: prev, currentSong: song });
      loadAndPlay(song);
    },

    seek: (seconds) => {
      const r = remote.current;
      if (r?.isRemote()) {
        set({ currentTime: seconds }); // show the new position at once; the real one arrives with the next state
        r.command('seek', seconds * 1000);
        return;
      }
      audio.currentTime = seconds;
      set({ currentTime: seconds });
    },

    setVolume: (v) => {
      const r = remote.current;
      if (r?.isRemote()) {
        r.setVolume(v); // the other device's volume — this device's own stays as it is
        return;
      }
      audio.volume = v;
      set({ volume: v });
    },

    toggleMute: () => {
      const r = remote.current;
      // While another device plays, "volume" is that device's: the bar (and keys) show and drive it.
      const volume = r?.isRemote() ? r.volume() : get().volume;
      let target: number;
      if (volume > 0) {
        volumeBeforeMute = volume;
        target = 0;
      } else {
        target = volumeBeforeMute ?? 1;
        volumeBeforeMute = null;
      }
      get().setVolume(target);
    },

    playNext: (song) => {
      const r = remote.current;
      if (r?.isRemote()) {
        r.queueAdd(song, 'next');
        return;
      }
      set((s) => {
        const insertAt = s.queueIndex + 1;
        const queue = [...s.queue.slice(0, insertAt), song, ...s.queue.slice(insertAt)];
        const originalQueue = s.originalQueue ? [...s.originalQueue, song] : s.originalQueue;
        return { queue, originalQueue };
      });
    },

    addToQueue: (song) => {
      const r = remote.current;
      if (r?.isRemote()) {
        r.queueAdd(song, 'end');
        return;
      }
      set((s) => ({
        queue: [...s.queue, song],
        originalQueue: s.originalQueue ? [...s.originalQueue, song] : s.originalQueue,
      }));
    },

    removeFromQueue: (index) => {
      const r = remote.current;
      if (r?.isRemote()) {
        r.queueRemove(index);
        return;
      }
      set((s) => {
        const removedSong = s.queue[index];
        const queue = s.queue.filter((_, i) => i !== index);
        let originalQueue = s.originalQueue;
        if (originalQueue && removedSong) {
          const origIdx = originalQueue.findIndex((sg) => sg.id === removedSong.id);
          if (origIdx !== -1) originalQueue = originalQueue.filter((_, i) => i !== origIdx);
        }
        let queueIndex = s.queueIndex;
        if (index < queueIndex) queueIndex--;
        else if (index === queueIndex) {
          // Stop if the current song is removed
          audio.pause();
          return { queue, queueIndex: -1, currentSong: null, playing: false, originalQueue };
        }
        return { queue, queueIndex, originalQueue };
      });
    },

    reorderQueue: (from, to) => {
      const r = remote.current;
      if (r?.isRemote()) {
        r.queueMove(from, to);
        return;
      }
      set((s) => {
        const queue = [...s.queue];
        const [moved] = queue.splice(from, 1);
        queue.splice(to, 0, moved);
        let queueIndex = s.queueIndex;
        if (from === queueIndex) {
          queueIndex = to;
        } else if (from < queueIndex && to >= queueIndex) {
          queueIndex--;
        } else if (from > queueIndex && to <= queueIndex) {
          queueIndex++;
        }
        return { queue, queueIndex };
      });
    },

    clearQueue: () => {
      audio.pause();
      set({ queue: [], queueIndex: -1, currentSong: null, playing: false, originalQueue: null });
    },

    toggleRepeat: () => {
      const order: RepeatMode[] = ['off', 'all', 'one'];
      const next = order[(order.indexOf(get().repeatMode) + 1) % order.length];
      set({ repeatMode: next });
    },

    toggleShuffle: () => {
      const { shuffle, queue, queueIndex, originalQueue } = get();
      if (shuffle) {
        // Turning off — restore the pre-shuffle order and resume from the current song.
        const restored = originalQueue ?? queue;
        const current = queue[queueIndex];
        const restoredIndex = current ? restored.findIndex((s) => s.id === current.id) : -1;
        set({ queue: restored, queueIndex: Math.max(restoredIndex, 0), shuffle: false, originalQueue: null });
        return;
      }
      if (!queue.length) {
        set({ shuffle: true });
        return;
      }
      const shuffled = buildShuffledQueue(queue, queueIndex);
      set({ originalQueue: queue, queue: shuffled, queueIndex: 0, shuffle: true });
    },
  };
});

// Wire up Media Session action handlers after store is created
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => usePlayerStore.getState().togglePlay());
  navigator.mediaSession.setActionHandler('pause', () => usePlayerStore.getState().togglePlay());
  navigator.mediaSession.setActionHandler('nexttrack', () => usePlayerStore.getState().next());
  navigator.mediaSession.setActionHandler('previoustrack', () => usePlayerStore.getState().prev());
  navigator.mediaSession.setActionHandler('seekto', (d) => {
    if (d.seekTime != null) usePlayerStore.getState().seek(d.seekTime);
  });
}
