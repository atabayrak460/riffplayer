import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AudioOutputState {
  /** The chosen output device (an opaque browser id), or null for the system default. */
  deviceId: string | null;
  /** What to call it ("JBL Flip 6") — also what the user's other devices are told. */
  label: string | null;
  choose: (deviceId: string, label: string) => void;
  useDefault: () => void;
}

/** Which speaker / headphones / Bluetooth device this browser plays through. Persisted, because the
 *  browser forgets nothing but the user would otherwise have to pick it on every visit. */
export const useAudioOutputStore = create<AudioOutputState>()(
  persist(
    (set) => ({
      deviceId: null,
      label: null,
      choose: (deviceId, label) => set({ deviceId, label: label.trim().slice(0, 40) || null }),
      useDefault: () => set({ deviceId: null, label: null }),
    }),
    { name: 'cadence-audio-output' },
  ),
);
