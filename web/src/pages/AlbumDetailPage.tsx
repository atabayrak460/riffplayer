import { QualityBadge } from '../components/QualityBadge';
import { albumQuality } from '../lib/quality';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAlbum } from '../api/subsonic';
import { usePlayerStore } from '../store/player';
import { useDownloadsStore } from '../store/downloads';
import { CoverArt } from '../components/CoverArt';
import { SongRow } from '../components/SongRow';
import { StarButton } from '../components/StarButton';
import { ContextMenu, useContextMenu } from '../components/ContextMenu';

const ICONS = {
  playNext: 'M5.25 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.348a1.875 1.875 0 0 1 0 3.284l-11.54 6.347c-1.25.688-2.779-.215-2.779-1.643V5.653Z',
  queue: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
  download: 'M12 3v13.5m0 0-4.5-4.5m4.5 4.5 4.5-4.5M4.5 19.5h15',
  more: 'M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Zm0 6a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Zm0 6a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z',
};

function formatDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

interface AlbumDownloadButtonProps {
  state: 'none' | 'downloading' | 'downloaded';
  disabled: boolean;
  onDownload: () => void;
  onRemove: () => void;
}

/** Labeled so it reads as an action next to Play, unlike the icon-only per-row buttons. */
function AlbumDownloadButton({ state, disabled, onDownload, onRemove }: AlbumDownloadButtonProps) {
  const base =
    'flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border transition-colors disabled:opacity-50';
  if (state === 'downloading') {
    return (
      <button disabled className={`${base} border-zinc-600 text-zinc-300`}>
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Downloading…
      </button>
    );
  }
  const downloaded = state === 'downloaded';
  return (
    <button
      onClick={downloaded ? onRemove : onDownload}
      disabled={disabled}
      title={downloaded ? 'Remove downloaded tracks' : 'Download album'}
      className={`${base} ${
        downloaded
          ? 'border-brand text-brand hover:border-red-400 hover:text-red-400'
          : 'border-zinc-600 text-zinc-200 hover:border-white hover:text-zinc-50'
      }`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.download} />
      </svg>
      {downloaded ? 'Downloaded' : 'Download'}
    </button>
  );
}

export function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const requestDownload = useDownloadsStore((s) => s.requestDownload);
  const removeTrackDownload = useDownloadsStore((s) => s.removeTrackDownload);
  const { menu, openAt, close } = useContextMenu();

  const { data: album, isLoading, isError } = useQuery({
    queryKey: ['album', id],
    queryFn: () => getAlbum(id!),
    enabled: !!id,
  });

  // An album isn't its own offline entity — derive its state from its tracks.
  // Selecting a primitive keeps the subscription from re-rendering on every
  // unrelated status change.
  const albumTrackIds = (album?.song ?? []).map((t) => t.id);
  const downloadState = useDownloadsStore((s) => {
    if (!albumTrackIds.length) return 'none';
    const states = albumTrackIds.map((tid) => s.status[`t:${tid}`]);
    if (states.some((st) => st === 'downloading')) return 'downloading';
    if (states.every((st) => st === 'downloaded')) return 'downloaded';
    return 'none';
  });

  if (isLoading) {
    return (
      <div className="p-6 flex gap-6">
        <div className="w-48 h-48 bg-zinc-800 rounded-lg animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-3 pt-2">
          <div className="h-7 bg-zinc-800 rounded animate-pulse w-48" />
          <div className="h-4 bg-zinc-800 rounded animate-pulse w-32" />
        </div>
      </div>
    );
  }

  if (isError || !album) {
    return <div className="p-6 text-red-400 text-sm">Album not found.</div>;
  }

  const songs = album.song ?? [];

  const menuItems = [
    { label: 'Play next', icon: ICONS.playNext, onClick: () => {
      for (const song of [...songs].reverse()) playNext(song);
    } },
    { label: 'Add to queue', icon: ICONS.queue, onClick: () => {
      for (const song of songs) addToQueue(song);
    } },
    { label: 'Download', icon: ICONS.download, onClick: () => requestDownload({ kind: 'album', songs }) },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-8">
        <CoverArt
          id={album.coverArt}
          size={300}
          className="w-40 h-40 sm:w-48 sm:h-48 rounded-lg shadow-xl flex-shrink-0 object-cover"
          alt={album.name}
        />
        <div className="flex flex-col justify-end gap-2 min-w-0">
          <p className="text-xs uppercase tracking-widest text-zinc-400">Album</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-50 break-words">{album.name}</h1>
          <p className="text-zinc-300">{album.artist}</p>
          <p className="text-sm text-zinc-500">
            {album.year && `${album.year} · `}{songs.length} tracks · {formatDuration(album.duration)}
          </p>
          <div><QualityBadge quality={albumQuality(songs)} /></div>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <button
              onClick={() => playQueue(songs)}
              className="bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium px-5 py-2 rounded-full transition-colors"
            >
              Play
            </button>
            <AlbumDownloadButton
              state={downloadState}
              disabled={!songs.length}
              onDownload={() => requestDownload({ kind: 'album', songs })}
              onRemove={() => {
                for (const song of songs) void removeTrackDownload(song.id);
              }}
            />
            <StarButton starred={!!album.starred} opts={{ albumId: album.id }} />
            <button
              onClick={(e) => openAt(e, menuItems)}
              title="More options"
              className="text-zinc-400 hover:text-zinc-50 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d={ICONS.more} />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Track list */}
      <div className="space-y-0.5">
        {songs.map((song, i) => (
          <SongRow key={song.id} song={song} queue={songs} index={i + 1} />
        ))}
      </div>

      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}
