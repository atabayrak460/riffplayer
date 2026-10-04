import { create } from 'zustand';
import { getRadio, type RadioSeedType } from '../api/subsonic';
import { usePlayerStore } from './player';
import { useToastStore } from './toast';
import type { Song } from '../api/types';

// "Radio": an endless queue seeded by a song, artist, album or playlist. The server picks the songs
// (see server/src/radio); this keeps the queue topped up while it plays, and switches itself off the
// moment the user plays something that did not come from the radio.

const BATCH = 30;
const REFILL_WHEN_LEFT = 5;
const MAX_EXCLUDE = 300;

export interface RadioSeed {
  type: RadioSeedType;
  id: string;
  /** What to call it in the UI ("Radio · Karma Police"). */
  name: string;
}

interface RadioState {
  seed: RadioSeed | null;
  start: (seed: RadioSeed, firstSong?: Song) => Promise<void>;
  stop: () => void;
}

let radioIds = new Set<string>();
let refilling = false;

export const useRadioStore = create<RadioState>()((set) => ({
  seed: null,

  start: async (seed, firstSong) => {
    const toast = useToastStore.getState();
    toast.show('Starting radio…');
    try {
      const batch = await getRadio(seed.type, seed.id, BATCH, firstSong ? [firstSong.id] : []);
      const songs = firstSong ? [firstSong, ...batch.filter((s) => s.id !== firstSong.id)] : batch;
      if (songs.length === 0) {
        toast.show('There isn’t enough music in your library to build a radio from this.');
        return;
      }
      radioIds = new Set(songs.map((s) => s.id));
      usePlayerStore.getState().playQueue(songs);
      set({ seed });
      toast.dismiss();
    } catch (e) {
      toast.show(e instanceof Error && e.message ? `Couldn't start the radio: ${e.message}` : "Couldn't start the radio");
    }
  },

  stop: () => {
    radioIds = new Set();
    set({ seed: null });
  },
}));

async function refill(): Promise<void> {
  const { seed } = useRadioStore.getState();
  if (!seed || refilling) return;
  refilling = true;
  try {
    const { queue, addToQueue } = usePlayerStore.getState();
    const exclude = queue.slice(-MAX_EXCLUDE).map((s) => s.id);
    const batch = await getRadio(seed.type, seed.id, BATCH, exclude);
    // The radio may have been stopped, or the queue replaced, while this was loading.
    if (useRadioStore.getState().seed !== seed) return;
    for (const song of batch) {
      radioIds.add(song.id);
      addToQueue(song);
    }
  } catch {
    // Offline or a hiccup: the queue just plays out; the next track change tries again.
  } finally {
    refilling = false;
  }
}

usePlayerStore.subscribe((state) => {
  const { seed, stop } = useRadioStore.getState();
  if (!seed) return;
  if (state.queue.length === 0 || (state.currentSong && !radioIds.has(state.currentSong.id))) {
    stop();
    return;
  }
  if (state.queue.length - state.queueIndex - 1 <= REFILL_WHEN_LEFT) void refill();
});
