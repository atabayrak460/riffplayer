// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { CUSTOM_PRESET, EQ_BANDS, EQ_PRESETS, useEqualizerStore } from './equalizer';

beforeEach(() => {
  localStorage.clear();
  useEqualizerStore.setState({ enabled: false, gains: [...EQ_PRESETS.Flat], preset: 'Flat' });
});

describe('equalizer store', () => {
  it('every preset has one gain per band, within ±12 dB', () => {
    for (const [name, gains] of Object.entries(EQ_PRESETS)) {
      expect(gains.length, name).toBe(EQ_BANDS.length);
      expect(Math.max(...gains.map(Math.abs)), name).toBeLessThanOrEqual(12);
    }
  });

  it('applying a preset copies its gains', () => {
    useEqualizerStore.getState().applyPreset('Rock');
    expect(useEqualizerStore.getState().gains).toEqual(EQ_PRESETS.Rock);
    expect(useEqualizerStore.getState().preset).toBe('Rock');
    expect(useEqualizerStore.getState().gains).not.toBe(EQ_PRESETS.Rock); // a copy, so edits can't change the preset
  });

  it('moving a band by hand turns the preset into Custom — and back when it matches again', () => {
    const s = useEqualizerStore.getState();
    s.setGain(3, 4);
    expect(useEqualizerStore.getState().preset).toBe(CUSTOM_PRESET);
    expect(useEqualizerStore.getState().gains[3]).toBe(4);
    useEqualizerStore.getState().setGain(3, 0);
    expect(useEqualizerStore.getState().preset).toBe('Flat');
  });

  it('clamps a band to ±12 dB in half-dB steps and ignores a band that does not exist', () => {
    const s = useEqualizerStore.getState();
    s.setGain(0, 99);
    expect(useEqualizerStore.getState().gains[0]).toBe(12);
    s.setGain(0, -99);
    expect(useEqualizerStore.getState().gains[0]).toBe(-12);
    s.setGain(1, 2.74);
    expect(useEqualizerStore.getState().gains[1]).toBe(2.5);
    const before = useEqualizerStore.getState().gains;
    s.setGain(42, 5);
    expect(useEqualizerStore.getState().gains).toEqual(before);
  });

  it('an unknown preset name changes nothing; reset goes back to Flat', () => {
    useEqualizerStore.getState().applyPreset('Rock');
    useEqualizerStore.getState().applyPreset('Nonexistent');
    expect(useEqualizerStore.getState().preset).toBe('Rock');
    useEqualizerStore.getState().reset();
    expect(useEqualizerStore.getState().gains).toEqual(EQ_PRESETS.Flat);
  });

  it('survives corrupted stored values', async () => {
    localStorage.setItem('cadence-equalizer', JSON.stringify({ state: { enabled: 'yes', gains: [1, 2, 'x'], preset: 7 }, version: 0 }));
    await useEqualizerStore.persist.rehydrate();
    const s = useEqualizerStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.gains).toHaveLength(EQ_BANDS.length);
    expect(s.gains.every((g) => Number.isFinite(g))).toBe(true);
  });
});
