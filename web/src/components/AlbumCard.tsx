import { Link } from 'react-router-dom';
import { usePlayerStore } from '../store/player';
import { useDownloadsStore } from '../store/downloads';
import { getAlbum } from '../api/subsonic';
import { CoverArt } from './CoverArt';
import { StarButton } from './StarButton';
import { ContextMenu, useContextMenu } from './ContextMenu';
import type { Album, Song } from '../api/types';

interface Props {
  album: Album;
}

const ICONS = {
  playNext: 'M5.25 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.348a1.875 1.875 0 0 1 0 3.284l-11.54 6.347c-1.25.688-2.779-.215-2.779-1.643V5.653Z',
  queue: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
  download: 'M12 3v13.5m0 0-4.5-4.5m4.5 4.5 4.5-4.5M4.5 19.5h15',
};

export function AlbumCard({ album }: Props) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const requestDownload = useDownloadsStore((s) => s.requestDownload);
  const { menu, handlers, close } = useContextMenu();

  const fetchSongs = async (): Promise<Song[]> => (await getAlbum(album.id)).song ?? [];

  const playAlbum = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      playQueue(await fetchSongs());
    } catch {
      // ignore
    }
  };

  const contextItems = [
    { label: 'Play next', icon: ICONS.playNext, onClick: async () => {
      for (const song of [...(await fetchSongs())].reverse()) playNext(song);
    } },
    { label: 'Add to queue', icon: ICONS.queue, onClick: async () => {
      for (const song of await fetchSongs()) addToQueue(song);
    } },
    { label: 'Download', icon: ICONS.download, onClick: async () => {
      requestDownload({ kind: 'album', songs: await fetchSongs() });
    } },
  ];

  return (
    <div {...handlers(contextItems)} className="group flex flex-col gap-2">
      <div className="relative aspect-square">
        <Link to={`/albums/${album.id}`}>
          <CoverArt
            id={album.coverArt}
            size={300}
            className="w-full h-full object-cover rounded-md"
            alt={album.name}
          />
        </Link>
        {/* Play button overlay */}
        <button
          onClick={playAlbum}
          className="absolute bottom-2 right-2 w-10 h-10 bg-brand rounded-full shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-150"
        >
          <svg className="w-5 h-5 text-on-brand ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5.14v14l11-7-11-7z" />
          </svg>
        </button>
      </div>

      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <Link
            to={`/albums/${album.id}`}
            className="text-sm font-medium text-zinc-50 hover:text-brand transition-colors line-clamp-1"
          >
            {album.name}
          </Link>
          <Link
            to={`/artists/${album.artistId}`}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors line-clamp-1"
          >
            {album.artist}
          </Link>
        </div>
        <StarButton starred={!!album.starred} opts={{ albumId: album.id }} className="flex-shrink-0 mt-0.5" />
      </div>

      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}
