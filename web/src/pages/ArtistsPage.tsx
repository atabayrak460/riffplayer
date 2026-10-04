import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getArtists } from '../api/subsonic';
import { CoverArt } from '../components/CoverArt';

export function ArtistsPage() {
  const { data: indexes = [], isLoading, isError } = useQuery({
    queryKey: ['artists'],
    queryFn: getArtists,
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Artists</h1>
        <div className="space-y-2">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="h-10 bg-zinc-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="p-6 text-red-400 text-sm">Failed to load artists.</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-zinc-50 mb-6">Artists</h1>
      {indexes.map((index) => (
        <div key={index.name} className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2 px-1">
            {index.name}
          </h2>
          <div className="space-y-0.5">
            {index.artist.map((artist) => (
              <Link
                key={artist.id}
                to={`/artists/${artist.id}`}
                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-800 transition-colors group"
              >
                <CoverArt
                  id={artist.coverArt}
                  size={48}
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  alt={artist.name}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-50 group-hover:text-brand transition-colors truncate">
                    {artist.name}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {artist.albumCount} {artist.albumCount === 1 ? 'album' : 'albums'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
