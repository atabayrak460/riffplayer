import { equalizerSupported } from '../lib/equalizer';
import { CUSTOM_PRESET, EQ_BANDS, EQ_PRESETS, EQ_RANGE_DB, useEqualizerStore } from '../store/equalizer';

const label = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

export function EqualizerSection() {
  const { enabled, gains, preset, setEnabled, setGain, applyPreset, reset } = useEqualizerStore();
  const supported = equalizerSupported();

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Equalizer</h2>

      {!supported && (
        <p role="note" className="text-sm text-amber-400 mb-4 max-w-xl">
          The equalizer isn&apos;t available here: your browser only lets it process audio that comes from the
          same address as this page. Open the app from your server&apos;s own address to use it.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm text-zinc-50">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!supported}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-brand"
          />
          Enable equalizer
        </label>
        <select
          aria-label="Equalizer preset"
          value={preset}
          disabled={!supported}
          onChange={(e) => applyPreset(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-sm text-zinc-50 rounded-lg px-3 py-1.5"
        >
          {preset === CUSTOM_PRESET && <option value={CUSTOM_PRESET}>{CUSTOM_PRESET}</option>}
          {Object.keys(EQ_PRESETS).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={reset}
          disabled={!supported}
          className="text-xs text-zinc-400 hover:text-zinc-50 disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      <div className={`flex gap-3 sm:gap-5 ${enabled && supported ? '' : 'opacity-50'}`}>
        {EQ_BANDS.map((hz, i) => (
          <div key={hz} className="flex flex-col items-center gap-2 w-8">
            <span className="text-[10px] text-zinc-400 tabular-nums">{gains[i] > 0 ? `+${gains[i]}` : gains[i]}</span>
            {/* Native range inputs are horizontal: lay one flat inside a tall box and turn it upright. */}
            <div className="relative h-32 w-6">
              <input
                type="range"
                aria-label={`${hz} Hz`}
                min={-EQ_RANGE_DB}
                max={EQ_RANGE_DB}
                step={0.5}
                value={gains[i]}
                disabled={!supported}
                onChange={(e) => setGain(i, Number(e.target.value))}
                className="absolute left-1/2 top-1/2 !w-32 -translate-x-1/2 -translate-y-1/2 -rotate-90"
              />
            </div>
            <span className="text-[10px] text-zinc-500">{label(hz)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-500 mt-4 max-w-xl">
        Boosted bands are balanced by an automatic volume cut, so loud music doesn&apos;t distort.
      </p>
    </section>
  );
}
