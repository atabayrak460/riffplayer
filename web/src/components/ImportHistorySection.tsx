import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getImportedHistory, importHistoryFile, importLastFm, removeImportedHistory,
  type ImportResult, type ImportSource,
} from '../api/subsonic';

const LABELS: Record<ImportSource, string> = { spotify: 'Spotify', apple_music: 'Apple Music', lastfm: 'Last.fm' };

function describe(r: ImportResult): string {
  const parts = [`${r.added.toLocaleString()} plays added from ${LABELS[r.source]}`];
  if (r.duplicates > 0) parts.push(`${r.duplicates.toLocaleString()} already counted`);
  if (r.truncated) parts.push('only the first part of the year was read — run it again to add the rest');
  return `${parts.join(', ')}.`;
}

/** Bring listening history from other services in, so Wrapped covers the whole year. */
export function ImportHistorySection() {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { data: sources = [] } = useQuery({ queryKey: ['imported-history'], queryFn: getImportedHistory });

  const done = (r: ImportResult) => {
    setMessage({ ok: true, text: describe(r) });
    void qc.invalidateQueries({ queryKey: ['imported-history'] });
    void qc.invalidateQueries({ queryKey: ['wrapped'] });
  };
  const failed = (e: Error) => setMessage({ ok: false, text: e.message });

  const upload = useMutation({ mutationFn: (f: File) => importHistoryFile(f), onSuccess: done, onError: failed });
  const lastfm = useMutation({ mutationFn: () => importLastFm(username.trim(), year), onSuccess: done, onError: failed });
  const remove = useMutation({
    mutationFn: (s: ImportSource) => removeImportedHistory(s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['imported-history'] });
      void qc.invalidateQueries({ queryKey: ['wrapped'] });
    },
  });

  const thisYear = new Date().getFullYear();
  const busy = upload.isPending || lastfm.isPending;

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Import listening history</h2>
      <p className="text-sm text-zinc-400 mb-3 max-w-md">
        Add your history from other services so Wrapped covers your whole year. Only names and times are kept — your data stays on this server.
      </p>

      <div className="max-w-md space-y-4">
        <div>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,.json,.csv"
            aria-label="Spotify or Apple Music export"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {upload.isPending ? 'Importing…' : 'Choose Spotify / Apple Music export'}
          </button>
          <p className="text-xs text-zinc-500 mt-2">
            Spotify: Account → Privacy → request “Extended streaming history”, then pick the .zip it emails you.
            Apple Music: privacy.apple.com → request a copy of your data → pick the .zip (or the “Play Activity” CSV).
          </p>
        </div>

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => { e.preventDefault(); if (username.trim()) lastfm.mutate(); }}
        >
          <input
            aria-label="Last.fm username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Last.fm username"
            maxLength={15}
            autoComplete="off"
            className="flex-1 min-w-[10rem] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          />
          <select
            aria-label="Year to import"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
          >
            {Array.from({ length: 5 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            type="submit"
            disabled={busy || !username.trim()}
            className="bg-zinc-700 hover:bg-zinc-600 text-sm font-medium px-4 rounded-lg disabled:opacity-50"
          >
            {lastfm.isPending ? 'Importing…' : 'Import from Last.fm'}
          </button>
          <p className="basis-full text-xs text-zinc-500">The Last.fm profile must be public. Needs the admin’s Last.fm key.</p>
        </form>
      </div>

      {message && <p className={`text-xs mt-3 ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}

      {sources.length > 0 && (
        <ul className="mt-4 max-w-md space-y-2" aria-label="Imported history">
          {sources.map((s) => (
            <li key={s.source} className="flex items-center justify-between text-sm text-zinc-50">
              <span>
                {LABELS[s.source]}
                <span className="block text-xs text-zinc-500">
                  {s.plays.toLocaleString()} plays · {s.matched.toLocaleString()} in your library
                </span>
              </span>
              <button type="button" onClick={() => remove.mutate(s.source)} className="text-xs text-zinc-400 hover:text-red-400">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
