import { useQuery } from '@tanstack/react-query';
import { getLastPlayed, getAlbum, getAlbumList } from '../../api/subsonic';
import { usePlayerStore } from '../../store/player';
import { CoverArt } from '../CoverArt';
import { AlbumCard } from '../AlbumCard';
import { HomeRow } from '../HomeRow';

export function ContinueListeningSection() {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const { data: lastPlayed } = useQuery({ queryKey: ['home-last-played'], queryFn: getLastPlayed });
  const { data: recentAlbums = [] } = useQuery({
    queryKey: ['home-recent-albums'],
    queryFn: () => getAlbumList('newest', { size: 12 }),
  });

  const resume = async () => {
    if (!lastPlayed) return;
    try {
      const album = await getAlbum(lastPlayed.albumId);
      const songs = album.song ?? [];
      const idx = songs.findIndex((s) => s.id === lastPlayed.id);
      playQueue(songs, idx === -1 ? 0 : idx);
    } catch {
      // ignore — nothing to resume if the album lookup fails
    }
  };

  if (!lastPlayed && recentAlbums.length === 0) return null;

  return (
    <section>
      <h2 className="text-xl font-bold text-zinc-50 mb-4">Continue Listening</h2>

      {lastPlayed && (
        <button
          onClick={resume}
          className="group flex items-center gap-4 bg-zinc-800/60 hover:bg-zinc-800 rounded-xl p-3 pr-5 mb-6 transition-colors text-left w-full max-w-md"
        >
          <CoverArt
            id={lastPlayed.coverArt}
            size={80}
            className="w-16 h-16 rounded-md object-cover flex-shrink-0"
            alt={lastPlayed.title}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Jump back in</p>
            <p className="text-zinc-50 font-semibold truncate group-hover:text-brand transition-colors">
              {lastPlayed.title}
            </p>
            <p className="text-sm text-zinc-400 truncate">
              {lastPlayed.artist} · {lastPlayed.album}
            </p>
          </div>
          <svg
            className="w-9 h-9 text-brand flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5.14v14l11-7-11-7z" />
          </svg>
        </button>
      )}

      {recentAlbums.length > 0 && (
        <HomeRow title="Recently added" viewAllTo="/albums">
          {recentAlbums.map((album) => (
            <div key={album.id} className="w-40 flex-shrink-0">
              <AlbumCard album={album} />
            </div>
          ))}
        </HomeRow>
      )}
    </section>
  );
}
