import { useQuery } from '@tanstack/react-query';
import { getStarred } from '../api/subsonic';
import { AlbumCard } from '../components/AlbumCard';
import { SongRow } from '../components/SongRow';
import { CoverArt } from '../components/CoverArt';
import { FavouritesCover } from '../components/StockCovers';
import { SystemViewHeader } from '../components/SystemViewHeader';
import { Link } from 'react-router-dom';

export function FavoritesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['starred'],
    queryFn: getStarred,
  });

  if (isLoading) return <div className="p-6 text-zinc-400 text-sm">Loading favourites…</div>;
  if (isError) return <div className="p-6 text-red-400 text-sm">Failed to load favourites.</div>;
  if (!data) return null;

  const empty = !data.artist.length && !data.album.length && !data.song.length;

  const parts = [
    data.artist.length > 0 && `${data.artist.length} artist${data.artist.length === 1 ? '' : 's'}`,
    data.album.length > 0 && `${data.album.length} album${data.album.length === 1 ? '' : 's'}`,
    data.song.length > 0 && `${data.song.length} song${data.song.length === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return (
    <div className="p-6">
      <SystemViewHeader
        viewKey="favorites"
        title="Favourites"
        defaultDescription="Your starred artists, albums, and songs"
        StockCover={FavouritesCover}
        meta={parts.length > 0 && `${parts.join(', ')} starred`}
      />

      <div className="space-y-8">
        {empty && (
          <p className="text-zinc-400 text-sm">
            Nothing starred yet. Hit the ★ on any song, album, or artist.
          </p>
        )}

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
                  <p className="text-sm font-medium text-zinc-50 group-hover:text-brand transition-colors">{artist.name}</p>
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
      </div>
    </div>
  );
}
