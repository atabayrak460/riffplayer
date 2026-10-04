import { streamUrl } from '../api/subsonic';
import { EQ_BANDS } from '../store/equalizer';

// The Web Audio graph behind the equalizer:
//   <audio> element(s) → MediaElementSource → pre-amp → 10 peaking filters → speakers
// Both player elements (current + pre-loaded next) feed the same chain. An element can only ever
// be wired into one graph, and — the catch — a cross-origin stream without CORS headers comes out
// of Web Audio as silence. So the graph is only built when the audio is same-origin with the page
// (the normal self-hosted setup, where the server also serves the web app).

interface Graph {
  ctx: AudioContext;
  input: GainNode;
  preamp: GainNode;
  filters: BiquadFilterNode[];
}

let graph: Graph | null = null;
const attached = new WeakSet<HTMLAudioElement>();

/** Whether the equalizer can work here: the browser has Web Audio and the server's audio is same-origin. */
export function equalizerSupported(): boolean {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return false;
  try {
    return new URL(streamUrl('probe'), window.location.href).origin === window.location.origin;
  } catch {
    return false; // not signed in yet
  }
}

function buildGraph(): Graph {
  const ctx = new AudioContext();
  const input = ctx.createGain();
  const preamp = ctx.createGain();
  const filters = EQ_BANDS.map((hz, i) => {
    const f = ctx.createBiquadFilter();
    // Shelves at the extremes, bells in between — the usual graphic-EQ shape.
    f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = hz;
    f.Q.value = 1.1;
    f.gain.value = 0;
    return f;
  });
  input.connect(preamp);
  let node: AudioNode = preamp;
  for (const f of filters) {
    node.connect(f);
    node = f;
  }
  node.connect(ctx.destination);
  return { ctx, input, preamp, filters };
}

/** Routes an audio element through the equalizer (idempotent). Returns false when unsupported. */
export function attachEqualizer(el: HTMLAudioElement): boolean {
  if (!equalizerSupported()) return false;
  graph ??= buildGraph();
  if (!attached.has(el)) {
    graph.ctx.createMediaElementSource(el).connect(graph.input);
    attached.add(el);
  }
  // Browsers start a context suspended until the user has interacted with the page.
  if (graph.ctx.state === 'suspended') void graph.ctx.resume().catch(() => {});
  return true;
}

/** Applies the band gains — or flat when [enabled] is false. A pre-amp cut equal to the biggest boost
 *  keeps boosted bands from clipping. */
export function updateEqualizer(enabled: boolean, gains: number[]): void {
  if (!graph) return;
  const g = enabled ? gains : gains.map(() => 0);
  graph.filters.forEach((f, i) => {
    f.gain.value = g[i] ?? 0;
  });
  const headroomDb = Math.max(0, ...g);
  graph.preamp.gain.value = Math.pow(10, -headroomDb / 20);
}

/** Test hook: forget the graph so each test starts clean. */
export function resetEqualizerForTests(): void {
  graph = null;
}
