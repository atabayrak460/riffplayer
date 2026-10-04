import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as offlineDb from '../lib/offlineDb';
import { usePlayerStore } from '../store/player';
import { useDownloadsStore } from '../store/downloads';
import { CoverArt } from '../components/CoverArt';
import { PlaylistCover } from '../components/StockCovers';
import { SongRow } from '../components/SongRow';
import { DownloadButton } from '../components/DownloadButton';

/** Read-only offline view of a downloaded playlist — not editable, works with no network. */
export function OfflinePlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const removePlaylistDownload = useDownloadsStore((s) => s.removePlaylistDownload);

  const { data: playlist, isLoading: loadingPlaylist } = useQuery({
    queryKey: ['downloaded-playlist', id],
    queryFn: () => offlineDb.getDownloadedPlaylist(id!),
    enabled: !!id,
  });

  const { data: tracks = [], isLoading: loadingTracks } = useQuery({
    queryKey: ['downloaded-playlist-tracks', id],
    queryFn: () => offlineDb.getTracksByIds(playlist!.trackIds),
    enabled: !!playlist,
  });

  if (loadingPlaylist || loadingTracks) {
    return <div className="p-6 text-zinc-400 text-sm">Loading…</div>;
  }
  if (!playlist) {
    return <div className="p-6 text-red-400 text-sm">This playlist isn't downloaded.</div>;
  }

  const songs = tracks.map((t) => t.song);

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 mb-8">
        <CoverArt
          id={playlist.coverArtId}
          size={160}
          className="w-32 h-32 sm:w-36 sm:h-36 rounded-lg object-cover shadow-xl flex-shrink-0"
          alt={playlist.name}
          fallback={<PlaylistCover className="w-full h-full" />}
        />
        <div className="flex flex-col justify-end gap-2 min-w-0">
          <p className="text-xs uppercase tracking-widest text-zinc-400">Downloaded Playlist</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-50 break-words">{playlist.name}</h1>
          <p className="text-sm text-zinc-400">{songs.length} {songs.length === 1 ? 'track' : 'tracks'}</p>
          {playlist.comment && <p className="text-sm text-zinc-400 max-w-md break-words">{playlist.comment}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <button
              onClick={() => playQueue(songs)}
              disabled={!songs.length}
              className="bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium px-5 py-2 rounded-full transition-colors disabled:opacity-50"
            >
              Play
            </button>
            <DownloadButton
              state="downloaded"
              onDownload={() => {}}
              onRemove={() => removePlaylistDownload(playlist.id)}
            />
          </div>
        </div>
      </div>

      {songs.length === 0 ? (
        <p className="text-zinc-400 text-sm">No tracks.</p>
      ) : (
        <div className="space-y-0.5">
          {songs.map((song, i) => (
            <SongRow key={song.id} song={song} queue={songs} index={i + 1} showAlbum />
          ))}
        </div>
      )}
    </div>
  );
}
