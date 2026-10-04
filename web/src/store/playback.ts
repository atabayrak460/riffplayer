import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '../api/types';

export type ReplayGainMode = 'off' | 'track' | 'album';

export const MAX_CROSSFADE_SECONDS = 12;
export const PREAMP_RANGE_DB = 12;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

interface PlaybackState {
  /** Level tracks to a common loudness: off, per track, or per album (keeps an album's own dynamics). */
  replayGain: ReplayGainMode;
  /** Extra gain in dB added to every ReplayGain-tagged track. */
  preampDb: number;
  /** Start the next track from a pre-loaded element the moment this one ends, so albums play without a gap. */
  gapless: boolean;
  /** Seconds of overlap between tracks; 0 = no crossfade. */
  crossfadeSec: number;
  setReplayGain: (m: ReplayGainMode) => void;
  setPreampDb: (db: number) => void;
  setGapless: (on: boolean) => void;
  setCrossfadeSec: (s: number) => void;
}

export const usePlaybackStore = create<PlaybackState>()(
  persist(
    (set) => ({
      replayGain: 'track',
      preampDb: 0,
      gapless: true,
      crossfadeSec: 0,
      setReplayGain: (replayGain) => set({ replayGain }),
      setPreampDb: (db) => set({ preampDb: clamp(Math.round(db * 2) / 2, -PREAMP_RANGE_DB, PREAMP_RANGE_DB) }),
      setGapless: (gapless) => set({ gapless }),
      setCrossfadeSec: (s) => set({ crossfadeSec: clamp(Math.round(s), 0, MAX_CROSSFADE_SECONDS) }),
    }),
    { name: 'cadence-playback' },
  ),
);

/** Linear volume multiplier for a track under the given ReplayGain settings (1 = untouched).
 *  Album mode uses the album gain and falls back to the track gain when a file has none;
 *  untagged tracks are left alone. */
export function replayGainLinear(song: Song | null | undefined, mode: ReplayGainMode, preampDb: number): number {
  if (!song || mode === 'off') return 1;
  const gainDb = mode === 'album' ? (song.replayGainAlbumGain ?? song.replayGainTrackGain) : song.replayGainTrackGain;
  if (gainDb == null) return 1;
  return Math.pow(10, (gainDb + preampDb) / 20);
}
