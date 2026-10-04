// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as subsonic from '../api/subsonic';
import { attachEqualizer, equalizerSupported, resetEqualizerForTests, updateEqualizer } from './equalizer';
import { EQ_BANDS } from '../store/equalizer';

class FakeNode {
  connected: FakeNode[] = [];
  gain = { value: 1 };
  frequency = { value: 0 };
  Q = { value: 0 };
  type = '';
  connect(n: FakeNode) {
    this.connected.push(n);
    return n;
  }
}
class FakeContext {
  static last: FakeContext;
  static count = 0;
  gains: FakeNode[] = [];
  state = 'suspended';
  destination = new FakeNode();
  sources: FakeNode[] = [];
  filters: FakeNode[] = [];
  constructor() {
    FakeContext.last = this;
    FakeContext.count++;
  }
  createGain() { const g = new FakeNode(); this.gains.push(g); return g; }
  createBiquadFilter() { const f = new FakeNode(); this.filters.push(f); return f; }
  createMediaElementSource() { const s = new FakeNode(); this.sources.push(s); return s; }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

beforeEach(() => {
  FakeContext.count = 0;
  resetEqualizerForTests();
  vi.restoreAllMocks();
  vi.stubGlobal('AudioContext', FakeContext);
  vi.spyOn(subsonic, 'streamUrl').mockReturnValue(`${window.location.origin}/rest/stream.view?id=probe`);
});

describe('equalizerSupported', () => {
  it('needs Web Audio and audio from the same origin as the page', () => {
    expect(equalizerSupported()).toBe(true);
    vi.spyOn(subsonic, 'streamUrl').mockReturnValue('https://other-server.example/rest/stream.view?id=x');
    expect(equalizerSupported()).toBe(false);
  });

  it('is false without Web Audio, and when not signed in', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(equalizerSupported()).toBe(false);
    vi.stubGlobal('AudioContext', FakeContext);
    vi.spyOn(subsonic, 'streamUrl').mockImplementation(() => { throw new Error('Not authenticated'); });
    expect(equalizerSupported()).toBe(false);
  });
});

describe('attachEqualizer', () => {
  it('builds one filter per band, shelves at the ends and bells between', () => {
    attachEqualizer(document.createElement('audio'));
    const f = FakeContext.last.filters;
    expect(f).toHaveLength(EQ_BANDS.length);
    expect(f.map((x) => x.frequency.value)).toEqual([...EQ_BANDS]);
    expect(f[0].type).toBe('lowshelf');
    expect(f[9].type).toBe('highshelf');
    expect(f[4].type).toBe('peaking');
  });

  it('wires each element once, however often it is attached', () => {
    const a = document.createElement('audio');
    attachEqualizer(a);
    attachEqualizer(a);
    attachEqualizer(document.createElement('audio'));
    expect(FakeContext.last.sources).toHaveLength(2);
  });

  it('wakes a suspended audio context', () => {
    attachEqualizer(document.createElement('audio'));
    expect(FakeContext.last.state).toBe('running');
  });

  it('does nothing — and builds nothing — when unsupported', () => {
    vi.spyOn(subsonic, 'streamUrl').mockReturnValue('https://other.example/stream');
    expect(attachEqualizer(document.createElement('audio'))).toBe(false);
    expect(FakeContext.count).toBe(0);
  });
});

describe('updateEqualizer', () => {
  it('sets the gains and cuts the pre-amp by the biggest boost to avoid clipping', () => {
    const a = document.createElement('audio');
    attachEqualizer(a);
    updateEqualizer(true, [6, 0, 0, 0, 0, 0, 0, 0, 0, -3]);
    const f = FakeContext.last.filters;
    expect(f[0].gain.value).toBe(6);
    expect(f[9].gain.value).toBe(-3);
    const preamp = FakeContext.last.gains[1]; // [0] is the input, [1] the pre-amp
    expect(preamp.gain.value).toBeCloseTo(Math.pow(10, -6 / 20), 6);
  });

  it('is flat when disabled', () => {
    attachEqualizer(document.createElement('audio'));
    updateEqualizer(true, [6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
    updateEqualizer(false, [6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
    expect(FakeContext.last.filters.every((f) => f.gain.value === 0)).toBe(true);
  });

  it('is a no-op before any element was attached', () => {
    expect(() => updateEqualizer(true, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).not.toThrow();
  });
});
