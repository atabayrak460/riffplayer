import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { adminGetSettings, adminPatchSettings } from '../../api/subsonic';

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-zinc-800/60">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-50">{label}</p>
        {description && <p className="text-xs text-zinc-400 mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-zinc-700'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function TextInput({ value, onChange, onBlur, placeholder, type = 'text', width = 'w-64' }: {
  value: string; onChange: (v: string) => void; onBlur: () => void;
  placeholder?: string; type?: string; width?: string;
}) {
  return (
    <input
      type={type} value={value}
      onChange={e => onChange(e.target.value)} onBlur={onBlur}
      placeholder={placeholder}
      className={`bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-50 ${width} focus:outline-none focus:border-brand`}
    />
  );
}

export function SettingsPage() {
  const { data: settings, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: adminGetSettings });
  const patchMut = useMutation({ mutationFn: adminPatchSettings });

  const [lfmKey, setLfmKey] = useState('');
  const [lfmSecret, setLfmSecret] = useState('');
  const [lfmEnabled, setLfmEnabled] = useState(false);
  const [recoEnabled, setRecoEnabled] = useState(true);
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [ollamaModel, setOllamaModel] = useState('llama3.2');
  const [donationEnabled, setDonationEnabled] = useState(true);
  const [lyricsLookup, setLyricsLookup] = useState(true);
  const [coverLookup, setCoverLookup] = useState(true);

  useEffect(() => {
    if (!settings) return;
    setLfmKey(settings.lastfm_api_key ?? '');
    setLfmSecret(settings.lastfm_api_secret ?? '');
    setLfmEnabled(settings.lastfm_enabled === 'true');
    setRecoEnabled(settings.recommendations_enabled !== 'false');
    setOllamaUrl(settings.ollama_url ?? '');
    setOllamaModel(settings.ollama_model ?? 'llama3.2');
    setDonationEnabled(settings.donation_prompt_enabled !== 'false');
    setLyricsLookup(settings.lyrics_lookup_enabled !== 'false');
    setCoverLookup(settings.cover_lookup_enabled !== 'false');
  }, [settings]);

  const save = (patch: Record<string, string | null>) => patchMut.mutate(patch);

  if (isLoading) return <div className="text-zinc-400 text-sm">Loading…</div>;

  return (
    <div>
      <h2 className="text-xl font-semibold text-zinc-50 mb-6">Server Settings</h2>

      <section className="mb-8">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Last.fm Scrobbling</h3>
        <Field label="Enable Last.fm" description="Scrobble plays to Last.fm for users who have configured a session key.">
          <Toggle checked={lfmEnabled} onChange={(v) => { setLfmEnabled(v); save({ lastfm_enabled: v ? 'true' : 'false' }); }} />
        </Field>
        <Field label="API Key" description="From last.fm/api/account/create — also used for recommendations">
          <TextInput value={lfmKey} onChange={setLfmKey} onBlur={() => save({ lastfm_api_key: lfmKey || null })} placeholder="Paste API key" />
        </Field>
        <Field label="Shared Secret" description="From your Last.fm API account page">
          <TextInput type="password" value={lfmSecret} onChange={setLfmSecret} onBlur={() => save({ lastfm_api_secret: lfmSecret || null })} placeholder="Paste shared secret" />
        </Field>
      </section>

      <section className="mb-8">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Recommendations (opt-in)</h3>
        <Field label="Enable recommendations" description="Similar artists and Discover weekly. Default off.">
          <Toggle checked={recoEnabled} onChange={(v) => { setRecoEnabled(v); save({ recommendations_enabled: v ? 'true' : 'false' }); }} />
        </Field>
        <Field label="Ollama URL" description="Local LLM for fully private recommendations. E.g. http://localhost:11434">
          <TextInput value={ollamaUrl} onChange={setOllamaUrl} onBlur={() => save({ ollama_url: ollamaUrl || null })} placeholder="http://localhost:11434" width="w-72" />
        </Field>
        <Field label="Ollama model" description="Model name as shown in `ollama list`. Fallback: llama3.2">
          <TextInput value={ollamaModel} onChange={setOllamaModel} onBlur={() => save({ ollama_model: ollamaModel || null })} placeholder="llama3.2" />
        </Field>
        <p className="text-xs text-zinc-500 pt-2">
          If Ollama is not configured, recommendations use Last.fm similar-artist data
          (requires Last.fm API key above). All suggestions come from your own library —
          no acquisition links are ever shown.
        </p>
      </section>

      <section className="mb-8">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">External metadata lookups</h3>
        <Field label="Look up lyrics online (LRCLIB)" description="When a track has no .lrc file next to it, sends its title, artist, album and duration to lrclib.net to find synced lyrics.">
          <Toggle checked={lyricsLookup} onChange={(v) => { setLyricsLookup(v); save({ lyrics_lookup_enabled: v ? 'true' : 'false' }); }} />
        </Field>
        <Field label="Look up album covers online (Cover Art Archive)" description="When an album has no embedded artwork, sends its MusicBrainz ID to coverartarchive.org. Your audio and listening history are never sent.">
          <Toggle checked={coverLookup} onChange={(v) => { setCoverLookup(v); save({ cover_lookup_enabled: v ? 'true' : 'false' }); }} />
        </Field>
      </section>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Donations</h3>
        <Field label="Show donation link" description="A quiet link in the sidebar. Disabling hides it for all users.">
          <Toggle checked={donationEnabled} onChange={(v) => { setDonationEnabled(v); save({ donation_prompt_enabled: v ? 'true' : 'false' }); }} />
        </Field>
      </section>

      {patchMut.isSuccess && <p className="text-green-400 text-xs mt-4">Saved.</p>}
    </div>
  );
}
