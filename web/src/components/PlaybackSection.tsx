import { MAX_CROSSFADE_SECONDS, PREAMP_RANGE_DB, usePlaybackStore, type ReplayGainMode } from '../store/playback';

const MODES: { value: ReplayGainMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Play every file as it is' },
  { value: 'track', label: 'Track', hint: 'Even loudness from song to song' },
  { value: 'album', label: 'Album', hint: 'Keeps an album’s own dynamics' },
];

const formatDb = (db: number) => `${db > 0 ? '+' : ''}${db} dB`;

export function PlaybackSection() {
  const { replayGain, preampDb, gapless, crossfadeSec, setReplayGain, setPreampDb, setGapless, setCrossfadeSec } =
    usePlaybackStore();

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Playback</h2>

      <h3 id="rg-label" className="text-sm font-medium text-zinc-50 mb-2">Volume levelling (ReplayGain)</h3>
      <div role="radiogroup" aria-labelledby="rg-label" className="flex flex-wrap gap-3">
        {MODES.map((m) => {
          const selected = replayGain === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setReplayGain(m.value)}
              className={`text-left px-4 py-3 rounded-lg border transition-colors ${
                selected ? 'border-brand bg-zinc-800' : 'border-zinc-700 hover:border-zinc-600'
              }`}
            >
              <span className={`block text-sm font-medium ${selected ? 'text-brand' : 'text-zinc-50'}`}>{m.label}</span>
              <span className="block text-xs text-zinc-400 mt-0.5">{m.hint}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500 mt-2">
        Uses the gain tags in your files. Browsers can&apos;t play louder than 100%, so a boost is capped there.
      </p>

      <div className={`mt-4 max-w-sm ${replayGain === 'off' ? 'opacity-50' : ''}`}>
        <label htmlFor="preamp" className="flex justify-between text-sm text-zinc-50 mb-1">
          <span>Pre-amp</span>
          <span className="text-zinc-400">{formatDb(preampDb)}</span>
        </label>
        <input
          id="preamp"
          type="range"
          min={-PREAMP_RANGE_DB}
          max={PREAMP_RANGE_DB}
          step={0.5}
          value={preampDb}
          disabled={replayGain === 'off'}
          onChange={(e) => setPreampDb(Number(e.target.value))}
        />
      </div>

      <div className="mt-6 flex items-start gap-3">
        <input
          id="gapless"
          type="checkbox"
          checked={gapless}
          onChange={(e) => setGapless(e.target.checked)}
          className="mt-1 accent-brand"
        />
        <label htmlFor="gapless" className="text-sm text-zinc-50">
          Gapless playback
          <span className="block text-xs text-zinc-400 mt-0.5">
            Loads the next song ahead of time so albums play without a pause between tracks.
          </span>
        </label>
      </div>

      <div className="mt-6 max-w-sm">
        <label htmlFor="crossfade" className="flex justify-between text-sm text-zinc-50 mb-1">
          <span>Crossfade</span>
          <span className="text-zinc-400">{crossfadeSec === 0 ? 'Off' : `${crossfadeSec} s`}</span>
        </label>
        <input
          id="crossfade"
          type="range"
          min={0}
          max={MAX_CROSSFADE_SECONDS}
          step={1}
          value={crossfadeSec}
          onChange={(e) => setCrossfadeSec(Number(e.target.value))}
        />
        <p className="text-xs text-zinc-500 mt-2">Overlaps the end of one song with the start of the next.</p>
      </div>
    </section>
  );
}
