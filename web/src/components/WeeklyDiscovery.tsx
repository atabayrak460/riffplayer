import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getWeeklyDiscovery, refreshWeeklyDiscovery, type WeeklyDiscovery as Weekly } from '../api/subsonic';

/** First letters on a coloured tile — suggestions have no artwork (and carry no links). */
function Initials({ name }: { name: string }) {
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.codePointAt(0)!) % 360;
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
  return (
    <div
      aria-hidden="true"
      className="w-12 h-12 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-bold"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 38%), hsl(${(hue + 50) % 360} 60% 22%))` }}
    >
      {letters || '♪'}
    </div>
  );
}

const formatWeek = (week: string) =>
  new Date(`${week}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' });

export function WeeklyDiscovery() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['weekly-discovery'], queryFn: getWeeklyDiscovery, retry: false });
  const refresh = useMutation({
    mutationFn: refreshWeeklyDiscovery,
    onSuccess: (fresh: Weekly) => qc.setQueryData(['weekly-discovery'], fresh),
  });

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 bg-zinc-800 rounded animate-pulse" />)}</div>;
  }
  if (isError || !data) {
    return <p className="text-sm text-red-400">Couldn&apos;t load this week&apos;s discoveries.</p>;
  }
  if (data.status === 'not_configured') {
    return (
      <p className="text-sm text-zinc-400 bg-zinc-800/60 rounded-lg p-5">
        Weekly discovery needs a Last.fm API key. An admin can add one in Settings → Admin.
      </p>
    );
  }
  if (data.status === 'no_history') {
    return (
      <p className="text-sm text-zinc-400 bg-zinc-800/60 rounded-lg p-5">
        Listen to some music first — discoveries are based on what you play.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-sm text-zinc-400">New for the week of {formatWeek(data.week)} — artists you don&apos;t have yet.</p>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="text-xs text-zinc-500 hover:text-zinc-50 disabled:opacity-50"
        >
          {refresh.isPending ? 'Refreshing…' : '↻ New picks'}
        </button>
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-zinc-400">Nothing new to suggest right now — check back next week.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.items.map((item) => (
            <li key={item.artist} className="flex items-center gap-3 bg-zinc-800/50 rounded-lg p-3">
              <Initials name={item.artist} />
              <div className="min-w-0">
                <p className="font-semibold text-zinc-50 truncate">{item.artist}</p>
                {item.track && <p className="text-sm text-zinc-300 truncate">Try: {item.track}</p>}
                {item.because.length > 0 && (
                  <p className="text-xs text-zinc-500 truncate">Because you listen to {item.because.join(', ')}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-zinc-600 mt-6">
        These are suggestions only — names of music that isn&apos;t in your library. RiffPlayer never provides links or
        sources to get it; finding it is up to you.
      </p>
    </div>
  );
}
