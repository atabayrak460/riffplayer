import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Centre frequencies (Hz) of the ten bands — the classic graphic-EQ layout. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_RANGE_DB = 12;

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -2, -1, 1, 3, 3, 2, 1, 0, -1],
  Rock: [4, 3, 1, -1, -2, 0, 2, 3, 4, 4],
  Electronic: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5],
  Classical: [0, 0, 0, 0, 0, 0, -2, -3, -3, -4],
  Loudness: [5, 3, 0, 0, -1, -1, 0, 1, 3, 4],
};

const clamp = (v: number) => Math.min(EQ_RANGE_DB, Math.max(-EQ_RANGE_DB, Math.round(v * 2) / 2));

export const CUSTOM_PRESET = 'Custom';

interface EqualizerState {
  enabled: boolean;
  /** Gain in dB for each of the ten bands. */
  gains: number[];
  /** The preset the gains match, or 'Custom' once a band has been moved by hand. */
  preset: string;
  setEnabled: (on: boolean) => void;
  setGain: (band: number, db: number) => void;
  applyPreset: (name: string) => void;
  reset: () => void;
}

export const useEqualizerStore = create<EqualizerState>()(
  persist(
    (set) => ({
      enabled: false,
      gains: EQ_PRESETS.Flat,
      preset: 'Flat',
      setEnabled: (enabled) => set({ enabled }),
      setGain: (band, db) =>
        set((s) => {
          if (band < 0 || band >= EQ_BANDS.length) return s;
          const gains = s.gains.map((g, i) => (i === band ? clamp(db) : g));
          const match = Object.entries(EQ_PRESETS).find(([, v]) => v.every((x, i) => x === gains[i]));
          return { gains, preset: match ? match[0] : CUSTOM_PRESET };
        }),
      applyPreset: (name) =>
        set((s) => (EQ_PRESETS[name] ? { gains: [...EQ_PRESETS[name]], preset: name } : s)),
      reset: () => set({ gains: [...EQ_PRESETS.Flat], preset: 'Flat' }),
    }),
    {
      name: 'cadence-equalizer',
      // Stored values come from localStorage: keep only a well-formed band list.
      merge: (persisted, current) => {
        const p = persisted as Partial<EqualizerState> | undefined;
        const gains =
          Array.isArray(p?.gains) && p.gains.length === EQ_BANDS.length && p.gains.every((g) => typeof g === 'number' && Number.isFinite(g))
            ? p.gains.map(clamp)
            : current.gains;
        return { ...current, enabled: p?.enabled === true, gains, preset: typeof p?.preset === 'string' ? p.preset : current.preset };
      },
    },
  ),
);
