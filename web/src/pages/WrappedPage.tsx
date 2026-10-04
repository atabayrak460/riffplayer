import { useState, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getWrapped, generateWrappedSummary } from '../api/subsonic';
import { CoverArt } from '../components/CoverArt';
import { WrappedCover } from '../components/StockCovers';
import { SystemViewHeader } from '../components/SystemViewHeader';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-zinc-800/60 rounded-xl p-5 flex flex-col gap-1">
      <p className="text-xs uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="text-3xl font-bold text-zinc-50">{value}</p>
      {sub && <p className="text-sm text-zinc-400">{sub}</p>}
    </div>
  );
}

/** Songs and artists that are not in this library (imported history) have nothing to open. */
function MaybeLink({ to, className, children }: { to: string | null; className: string; children: ReactNode }) {
  return to ? <Link to={to} className={className}>{children}</Link> : <div className={className}>{children}</div>;
}

export function WrappedPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['wrapped', year],
    queryFn: () => getWrapped(year),
    retry: false,
  });

  const summaryMut = useMutation({
    mutationFn: () => generateWrappedSummary(year),
  });

  const maxMonth = Math.max(...(stats?.byMonth.map((m) => m.plays) ?? [1]));

  const defaultDescription = stats && stats.totalPlays > 0
    ? `${stats.totalPlays.toLocaleString()} plays across ${year}`
    : 'Your year in music';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <SystemViewHeader
        viewKey="wrapped"
        title="Wrapped"
        defaultDescription={defaultDescription}
        StockCover={WrappedCover}
        meta={
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 text-sm text-zinc-50 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        }
      />

      {isLoading && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-zinc-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-zinc-400 text-sm">No play history found for {year}.</p>
      )}

      {stats && stats.totalPlays === 0 && (
        <p className="text-zinc-400 text-sm">No plays recorded for {year} yet.</p>
      )}

      {stats && stats.totalPlays > 0 && (
        <div className="space-y-8">
          {/* Key stats */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Total plays" value={stats.totalPlays.toLocaleString()} />
            <StatCard
              label="Listening time"
              value={`${Math.round(stats.totalMinutes / 60).toLocaleString()} hrs`}
              sub={`${stats.totalMinutes.toLocaleString()} min`}
            />
          </div>
          {stats.importedPlays > 0 && (
            <p className="text-xs text-zinc-500 -mt-5">
              Includes {stats.importedPlays.toLocaleString()} plays imported from other services.
            </p>
          )}

          {/* Top track + artist */}
          {stats.topTracks[0] && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Top track</h2>
              <MaybeLink
                to={stats.topTracks[0].external ? null : `/albums/${stats.topTracks[0].albumId}`}
                className="flex items-center gap-4 bg-zinc-800/60 rounded-xl p-4 hover:bg-zinc-800 transition-colors"
              >
                <CoverArt
                  id={stats.topTracks[0].coverArt ?? undefined}
                  size={64}
                  className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                />
                <div>
                  <p className="text-lg font-bold text-zinc-50">{stats.topTracks[0].title}</p>
                  <p className="text-sm text-zinc-400">{stats.topTracks[0].artist}</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {stats.topTracks[0].playCount} plays
                  </p>
                </div>
              </MaybeLink>
            </div>
          )}

          {/* Top artists */}
          {stats.topArtists.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Top artists</h2>
              <div className="space-y-2">
                {stats.topArtists.slice(0, 5).map((artist, i) => (
                  <MaybeLink
                    key={artist.id || artist.name}
                    to={artist.id ? `/artists/${artist.id}` : null}
                    className="flex items-center gap-3 hover:bg-zinc-800/50 rounded-lg px-3 py-2 transition-colors"
                  >
                    <span className="text-sm text-zinc-500 w-5 text-right">{i + 1}</span>
                    <CoverArt
                      id={artist.coverArt ?? undefined}
                      size={36}
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                    />
                    <p className="text-sm font-medium text-zinc-50 flex-1">{artist.name}</p>
                    <p className="text-xs text-zinc-500">{artist.playCount} plays</p>
                  </MaybeLink>
                ))}
              </div>
            </div>
          )}

          {/* Listening by month */}
          {stats.byMonth.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Plays by month</h2>
              <div className="flex items-end gap-2 h-24">
                {MONTHS.map((label, idx) => {
                  const monthData = stats.byMonth.find((m) => m.month === idx + 1);
                  const plays = monthData?.plays ?? 0;
                  const height = maxMonth > 0 ? Math.round((plays / maxMonth) * 100) : 0;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full bg-brand/70 rounded-sm"
                        style={{ height: `${height}%`, minHeight: plays > 0 ? 4 : 0 }}
                        title={`${label}: ${plays} plays`}
                      />
                      <span className="text-[10px] text-zinc-600">{label[0]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI summary */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">AI summary</h2>
            {summaryMut.data ? (
              <div className="bg-zinc-800/60 rounded-xl p-5">
                <p className="text-sm text-zinc-200 leading-relaxed">{summaryMut.data}</p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => summaryMut.mutate()}
                  disabled={summaryMut.isPending}
                  className="bg-brand hover:bg-brand-dim disabled:opacity-60 text-on-brand text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  {summaryMut.isPending ? 'Generating…' : 'Generate with Ollama'}
                </button>
                <p className="text-xs text-zinc-500">Requires Ollama configured in Settings → Admin</p>
              </div>
            )}
            {summaryMut.isError && (
              <p className="text-xs text-red-400 mt-2">
                {String(summaryMut.error).replace('Error: ', '')}
              </p>
            )}
          </div>

          {/* All top tracks */}
          {stats.topTracks.length > 1 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">All top tracks</h2>
              <div className="space-y-1">
                {stats.topTracks.map((t, i) => (
                  <MaybeLink
                    key={t.id || `${t.artist}-${t.title}`}
                    to={t.external ? null : `/albums/${t.albumId}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors"
                  >
                    <span className="text-sm text-zinc-500 w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-50 truncate">{t.title}</p>
                      <p className="text-xs text-zinc-400 truncate">{t.artist} · {t.album}</p>
                    </div>
                    <p className="text-xs text-zinc-500 flex-shrink-0">{t.playCount} plays</p>
                  </MaybeLink>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
