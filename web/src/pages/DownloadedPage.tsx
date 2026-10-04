import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as offlineDb from '../lib/offlineDb';
import { useDownloadsStore } from '../store/downloads';
import { CoverArt } from '../components/CoverArt';
import { PlaylistCover, DownloadedCover } from '../components/StockCovers';
import { DownloadButton } from '../components/DownloadButton';
import { SongRow } from '../components/SongRow';
import { SystemViewHeader } from '../components/SystemViewHeader';
import { isIOS } from '../lib/platform';

export function DownloadedPage() {
  const removePlaylistDownload = useDownloadsStore((s) => s.removePlaylistDownload);

  const { data: playlists = [], isLoading: loadingPlaylists } = useQuery({
    queryKey: ['downloaded-playlists'],
    queryFn: offlineDb.getAllDownloadedPlaylists,
  });

  const { data: tracks = [], isLoading: loadingTracks } = useQuery({
    queryKey: ['downloaded-tracks'],
    queryFn: offlineDb.getAllDownloadedTracks,
  });

  const songs = [...tracks].sort((a, b) => b.downloadedAt - a.downloadedAt).map((t) => t.song);
  const isLoading = loadingPlaylists || loadingTracks;

  const counts = [
    playlists.length > 0 && `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`,
    songs.length > 0 && `${songs.length} track${songs.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(', ');

  return (
    <div className="p-6">
      <SystemViewHeader
        viewKey="downloaded"
        title="Downloaded"
        defaultDescription="Available offline"
        StockCover={DownloadedCover}
        meta={counts || undefined}
      />

      {isIOS() && (
        <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-6">
          On iOS, Safari may clear downloads if you don't open RiffPlayer for a while — reopening the
          app periodically keeps them alive. The native app (coming later) won't have this limit.
        </p>
      )}

      {isLoading ? (
        <div className="space-y-1 mt-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-zinc-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {playlists.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">
                Downloaded Playlists
              </h2>
              <div className="space-y-1">
                {playlists.map((pl) => (
                  <div
                    key={pl.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800 group"
                  >
                    <Link to={`/downloaded/playlists/${pl.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                      <CoverArt
                        id={pl.coverArtId}
                        size={48}
                        className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                        alt={pl.name}
                        fallback={<PlaylistCover className="w-full h-full" />}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-50 group-hover:text-brand transition-colors truncate">
                          {pl.name}
                        </p>
                        <p className="text-xs text-zinc-400">
                          {pl.trackIds.length} {pl.trackIds.length === 1 ? 'track' : 'tracks'}
                        </p>
                      </div>
                    </Link>
                    <DownloadButton
                      state="downloaded"
                      onDownload={() => {}}
                      onRemove={() => removePlaylistDownload(pl.id)}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">
              All Downloaded Songs
            </h2>
            {songs.length === 0 ? (
              <p className="text-zinc-400 text-sm">
                No downloads yet — use the ⋯ menu on any song to download it for offline listening.
              </p>
            ) : (
              <div className="space-y-0.5">
                {songs.map((song, i) => (
                  <SongRow key={song.id} song={song} queue={songs} index={i + 1} showAlbum />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
