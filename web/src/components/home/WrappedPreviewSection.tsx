import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getWrapped } from '../../api/subsonic';
import { WrappedCover } from '../StockCovers';

export function WrappedPreviewSection() {
  const year = new Date().getFullYear();
  const { data: stats } = useQuery({
    queryKey: ['home-wrapped', year],
    queryFn: () => getWrapped(year),
    retry: false,
  });

  if (!stats || stats.totalPlays === 0) return null;

  const topArtist = stats.topArtists[0];
  const headline = topArtist
    ? `${topArtist.name} was your top artist`
    : `${stats.totalPlays} plays so far`;

  return (
    <section>
      <h2 className="text-xl font-bold text-zinc-50 mb-4">Wrapped preview</h2>
      <Link
        to="/wrapped"
        className="group flex items-center gap-4 bg-zinc-800/60 hover:bg-zinc-800 rounded-xl p-3 pr-5 transition-colors max-w-md"
      >
        <WrappedCover className="w-16 h-16 rounded-lg shadow-lg flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Your {year} Wrapped</p>
          <p className="text-zinc-50 font-semibold truncate group-hover:text-brand transition-colors">
            {headline}
          </p>
          <p className="text-sm text-zinc-400">
            {stats.totalPlays.toLocaleString()} plays · {Math.round(stats.totalMinutes / 60).toLocaleString()} hrs
          </p>
        </div>
        <svg
          className="w-5 h-5 text-zinc-500 group-hover:text-brand flex-shrink-0 transition-colors"
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </Link>
    </section>
  );
}
