import { Link } from 'react-router-dom';
import { getPlaylist } from '../api/subsonic';
import { usePlayerStore } from '../store/player';
import { useDownloadsStore } from '../store/downloads';
import { CoverArt } from './CoverArt';
import { PlaylistCover } from './StockCovers';
import { ContextMenu, useContextMenu } from './ContextMenu';
import type { Playlist } from '../api/types';

interface Props {
  pl: Playlist;
  onDelete: () => void;
}

export function PlaylistCard({ pl, onDelete }: Props) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const downloadState = useDownloadsStore((s) => s.playlistState(pl.id));
  const requestDownload = useDownloadsStore((s) => s.requestDownload);
  const removePlaylistDownload = useDownloadsStore((s) => s.removePlaylistDownload);
  const { menu, handlers, close } = useContextMenu();

  const startDownload = async () => {
    const full = await getPlaylist(pl.id);
    requestDownload({ kind: 'playlist', playlist: full, songs: full.entry ?? [] });
  };

  const playPlaylist = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const full = await getPlaylist(pl.id);
      playQueue(full.entry ?? []);
    } catch {
      // ignore
    }
  };

  const deletePlaylist = () => {
    if (confirm(`Delete "${pl.name}"?`)) onDelete();
  };

  const contextItems = [
    downloadState === 'downloaded'
      ? { label: 'Remove download', onClick: () => removePlaylistDownload(pl.id), danger: true }
      : { label: 'Download', onClick: startDownload },
    { label: 'Delete playlist', onClick: deletePlaylist, danger: true },
  ];

  return (
    <div {...handlers(contextItems)} className="group flex flex-col gap-2">
      <div className="relative aspect-square">
        <Link to={`/playlists/${pl.id}`}>
          <CoverArt
            id={pl.coverArt}
            size={300}
            className="w-full h-full object-cover rounded-md"
            alt={pl.name}
            fallback={<PlaylistCover className="w-full h-full" />}
          />
        </Link>
        {pl.songCount > 0 && (
          <button
            onClick={playPlaylist}
            title="Play"
            className="absolute bottom-2 right-2 w-10 h-10 bg-brand rounded-full shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-150"
          >
            <svg className="w-5 h-5 text-on-brand ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          </button>
        )}
      </div>

      <div className="min-w-0">
        <Link
          to={`/playlists/${pl.id}`}
          className="text-base font-semibold text-zinc-50 hover:text-brand transition-colors line-clamp-1 block"
        >
          {pl.name}
        </Link>
        {pl.comment && <p className="text-sm text-zinc-400 line-clamp-2 mt-0.5">{pl.comment}</p>}
        <p className="text-xs text-zinc-500 mt-1">
          {pl.songCount} {pl.songCount === 1 ? 'track' : 'tracks'}
        </p>
      </div>

      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}
