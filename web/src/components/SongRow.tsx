import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePlayerStore } from '../store/player';
import { useDownloadsStore } from '../store/downloads';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { adminDeleteTrack } from '../api/subsonic';
import { shareSong } from '../lib/share';
import { useRadioStore } from '../store/radio';
import { StarButton } from './StarButton';
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu';
import { CoverArt } from './CoverArt';
import { AddToPlaylistDialog } from './AddToPlaylistDialog';
import { SongInfoDialog } from './SongInfoDialog';
import type { Song } from '../api/types';

interface Props {
  song: Song;
  queue?: Song[];
  index?: number;
  showAlbum?: boolean;
  /**
   * ISO date shown as a right-aligned "date added" column when set — pass the
   * playlist_tracks.added_at date inside playlist views, or the track's own
   * `created` (library index date) inside library-wide views like All Songs.
   */
  addedAt?: string;
  /** Compact layout for narrow contexts (e.g. the Now Playing panel) — no cover thumbnail, no star, smaller text. */
  condensed?: boolean;
  /** Shown as the condensed row's subtitle when set (e.g. an album name) — condensed mode only. */
  condensedSubtitle?: string;
}

function formatDuration(s?: number) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatAddedDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const ICONS = {
  playNext: 'M5.25 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.348a1.875 1.875 0 0 1 0 3.284l-11.54 6.347c-1.25.688-2.779-.215-2.779-1.643V5.653Z',
  queue: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
  playlist: 'M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  download: 'M12 3v13.5m0 0-4.5-4.5m4.5 4.5 4.5-4.5M4.5 19.5h15',
  trash: 'm14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
  album: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
  artist: 'M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z',
  radio: 'M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
  share: 'M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z',
  info: 'M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
  more: 'M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Zm0 6a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Zm0 6a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z',
};

export function SongRow({
  song, queue, index, showAlbum = false, addedAt, condensed = false, condensedSubtitle,
}: Props) {
  const navigate = useNavigate();
  const playSong = usePlayerStore((s) => s.playSong);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const playing = usePlayerStore((s) => s.playing);
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const isCurrent = currentSong?.id === song.id;
  const downloadState = useDownloadsStore((s) => s.trackState(song.id));
  const requestDownload = useDownloadsStore((s) => s.requestDownload);
  const removeTrackDownload = useDownloadsStore((s) => s.removeTrackDownload);
  const { menu, handlers, openAt, close } = useContextMenu();
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const qc = useQueryClient();

  const play = () => playSong(song, queue);

  const deleteSong = () => {
    if (!confirm(`Permanently delete "${song.title}"? This deletes the file and cannot be undone.`)) return;
    adminDeleteTrack(song.id)
      .then(() => {
        useToastStore.getState().show(`Deleted "${song.title}"`);
        // Could be showing up in any number of lists (album, playlist, All
        // Songs, search, favorites, ...) — simplest to just refetch
        // everything rather than track down every query key that might
        // include it, for a rare, deliberate admin action.
        qc.invalidateQueries();
      })
      .catch((e) => {
        useToastStore.getState().show(e instanceof Error ? e.message : 'Failed to delete song');
      });
  };

  const menuItems: ContextMenuItem[] = [
    { label: 'Play next', icon: ICONS.playNext, onClick: () => playNext(song) },
    { label: 'Add to queue', icon: ICONS.queue, onClick: () => addToQueue(song) },
    { label: 'Add to playlist', icon: ICONS.playlist, onClick: () => setShowAddToPlaylist(true) },
    downloadState === 'downloaded'
      ? { label: 'Remove download', icon: ICONS.trash, onClick: () => removeTrackDownload(song.id), danger: true }
      : { label: 'Download', icon: ICONS.download, onClick: () => requestDownload({ kind: 'track', song }) },
    { label: 'Go to album', icon: ICONS.album, onClick: () => navigate(`/albums/${song.albumId}`) },
    { label: 'Go to artist', icon: ICONS.artist, onClick: () => navigate(`/artists/${song.artistId}`) },
    { label: 'Start radio', icon: ICONS.radio, onClick: () => void useRadioStore.getState().start({ type: 'song', id: song.id, name: song.title }, song) },
    { label: 'Share as picture', icon: ICONS.share, onClick: () => void shareSong(song) },
    { label: 'Song info', icon: ICONS.info, onClick: () => setShowInfo(true) },
    ...(isAdmin ? [{ label: 'Delete song', icon: ICONS.trash, onClick: deleteSong, danger: true }] : []),
  ];

  if (condensed) {
    return (
      <div
        onDoubleClick={play}
        {...handlers(menuItems)}
        className={`group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800/70 cursor-pointer transition-colors ${isCurrent ? 'bg-zinc-800' : ''}`}
      >
        <div className="w-5 text-center flex-shrink-0">
          {isCurrent ? (
            <span className="text-brand text-xs">{playing ? '▶' : '❚❚'}</span>
          ) : (
            <span className="text-zinc-500 text-xs group-hover:hidden">{index ?? ''}</span>
          )}
          <button
            onClick={play}
            className={`text-zinc-200 text-xs ${isCurrent ? 'hidden' : 'hidden group-hover:block'}`}
          >
            ▶
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium truncate ${isCurrent ? 'text-brand' : 'text-zinc-50'}`}>
            {song.title}
          </p>
          {condensedSubtitle && <p className="text-[11px] text-zinc-500 truncate">{condensedSubtitle}</p>}
        </div>

        <span className="text-xs text-zinc-500 flex-shrink-0">{formatDuration(song.duration)}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openAt(e, menuItems);
          }}
          title="More options"
          className="text-zinc-500 hover:text-zinc-50 transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d={ICONS.more} />
          </svg>
        </button>

        <ContextMenu menu={menu} onClose={close} />
        {showAddToPlaylist && (
          <AddToPlaylistDialog songId={song.id} onClose={() => setShowAddToPlaylist(false)} />
        )}
        {showInfo && <SongInfoDialog song={song} onClose={() => setShowInfo(false)} />}
      </div>
    );
  }

  return (
    <div
      onDoubleClick={play}
      {...handlers(menuItems)}
      className={`group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-800/70 cursor-pointer transition-colors ${isCurrent ? 'bg-zinc-800' : ''}`}
    >
      {/* Track number / play indicator */}
      <div className="w-7 text-center flex-shrink-0">
        {isCurrent ? (
          <span className="text-brand text-sm">{playing ? '▶' : '❚❚'}</span>
        ) : (
          <span className="text-zinc-500 text-sm group-hover:hidden">{index ?? ''}</span>
        )}
        <button
          onClick={play}
          className={`text-zinc-200 text-sm ${isCurrent ? 'hidden' : 'hidden group-hover:block'}`}
        >
          ▶
        </button>
      </div>

      {/* Album cover thumbnail */}
      <CoverArt
        id={song.coverArt}
        size={80}
        className="w-10 h-10 rounded object-cover flex-shrink-0"
        alt=""
      />

      {/* Title + artist */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isCurrent ? 'text-brand' : 'text-zinc-50'}`}>
          {song.title}
        </p>
        {showAlbum && (
          <p className="text-xs text-zinc-400 truncate">
            {song.artist} · {song.album}
          </p>
        )}
        {!showAlbum && <p className="text-xs text-zinc-400 truncate">{song.artist}</p>}
      </div>

      {/* Date added (playlist views only) + duration + star + more options */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {addedAt && (
          <span className="text-xs text-zinc-500 w-20 text-right hidden sm:inline">
            {formatAddedDate(addedAt)}
          </span>
        )}
        <StarButton starred={!!song.starred} opts={{ id: song.id }} />
        <span className="text-sm text-zinc-400 w-10 text-right">
          {formatDuration(song.duration)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openAt(e, menuItems);
          }}
          title="More options"
          className="text-zinc-400 hover:text-zinc-50 transition-colors flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d={ICONS.more} />
          </svg>
        </button>
      </div>

      <ContextMenu menu={menu} onClose={close} />
      {showAddToPlaylist && (
        <AddToPlaylistDialog songId={song.id} onClose={() => setShowAddToPlaylist(false)} />
      )}
      {showInfo && <SongInfoDialog song={song} onClose={() => setShowInfo(false)} />}
    </div>
  );
}
