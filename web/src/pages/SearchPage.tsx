import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { search } from '../api/subsonic';
import { AlbumCard } from '../components/AlbumCard';
import { SongRow } from '../components/SongRow';
import { CoverArt } from '../components/CoverArt';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['search', submitted],
    queryFn: () => search(submitted),
    enabled: submitted.length > 0,
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-zinc-50 mb-6">Search</h1>

      <form onSubmit={onSubmit} className="flex gap-2 mb-8 max-w-xl">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Artists, albums, songs…"
          autoFocus
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          Search
        </button>
      </form>

      {isLoading && <p className="text-zinc-400 text-sm">Searching…</p>}

      {data && (
        <div className="space-y-8">
          {data.artist.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Artists</h2>
              <div className="space-y-0.5">
                {data.artist.map((artist) => (
                  <Link
                    key={artist.id}
                    to={`/artists/${artist.id}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-800 transition-colors group"
                  >
                    <CoverArt id={artist.coverArt} size={48} className="w-10 h-10 rounded-full object-cover" alt={artist.name} />
                    <p className="text-sm text-zinc-50 group-hover:text-brand transition-colors">{artist.name}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {data.album.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Albums</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {data.album.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            </section>
          )}

          {data.song.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Songs</h2>
              <div className="space-y-0.5">
                {data.song.map((song, i) => (
                  <SongRow key={song.id} song={song} queue={data.song} index={i + 1} showAlbum />
                ))}
              </div>
            </section>
          )}

          {data.artist.length === 0 && data.album.length === 0 && data.song.length === 0 && (
            <p className="text-zinc-400 text-sm">No results for "{submitted}".</p>
          )}
        </div>
      )}
    </div>
  );
}
