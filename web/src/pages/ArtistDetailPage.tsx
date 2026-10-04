import { useRadioStore } from '../store/radio';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getArtist, getAlbum, uploadArtistCover, removeArtistCover } from '../api/subsonic';
import { usePlayerStore } from '../store/player';
import { useAuthStore } from '../store/auth';
import { useArtistSongs } from '../lib/useArtistSongs';
import { CoverUploadControl } from '../components/CoverUploadControl';
import { AlbumCard } from '../components/AlbumCard';
import { StarButton } from '../components/StarButton';
import { SongRow } from '../components/SongRow';

type Tab = 'albums' | 'songs';

export function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'songs' ? 'songs' : 'albums');

  const { data: artist, isLoading, isError } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id!),
    enabled: !!id,
  });

  const albums = artist?.album ?? [];

  // Same aggregation the Now Playing panel's "More from this artist" section
  // uses — shared query keys mean whichever loads first caches it for the other.
  const { songs: allSongs, isLoading: loadingSongs } = useArtistSongs(id, tab === 'songs');

  const coverMutation = useMutation({
    mutationFn: (file: File) => uploadArtistCover(id!, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artist', id] });
      qc.invalidateQueries({ queryKey: ['artists'] });
    },
  });
  const removeCoverMutation = useMutation({
    mutationFn: () => removeArtistCover(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artist', id] });
      qc.invalidateQueries({ queryKey: ['artists'] });
    },
  });
  const coverError = coverMutation.isError
    ? coverMutation.error instanceof Error
      ? coverMutation.error.message
      : 'Upload failed'
    : null;

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="h-8 bg-zinc-800 rounded animate-pulse w-48 mb-8" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square bg-zinc-800 rounded-md animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !artist) {
    return <div className="p-6 text-red-400 text-sm">Artist not found.</div>;
  }

  const playAll = async () => {
    const songs = (
      await Promise.all(albums.map((a) => getAlbum(a.id).then((r) => r.song ?? [])))
    ).flat();
    if (songs.length) playQueue(songs);
  };

  return (
    <div className="p-6">
      <div className="flex items-end gap-5 mb-8">
        <CoverUploadControl
          coverId={artist.coverArt}
          coverSize={160}
          coverClassName="w-32 h-32 rounded-full object-cover shadow-xl"
          alt={artist.name}
          shape="circle"
          visible={isAdmin}
          hasCover={!!artist.coverArt}
          uploadTitle="Upload photo"
          removeTitle="Remove photo"
          onUpload={(file) => coverMutation.mutate(file)}
          onRemove={() => removeCoverMutation.mutate()}
          error={coverError}
        />
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-400">Artist</p>
          <h1 className="text-3xl font-bold text-zinc-50 mt-1">{artist.name}</h1>
          <p className="text-sm text-zinc-400 mt-1">
            {albums.length} {albums.length === 1 ? 'album' : 'albums'}
          </p>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={playAll}
              className="bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium px-5 py-2 rounded-full transition-colors"
            >
              Play all
            </button>
            <button
              onClick={() => void useRadioStore.getState().start({ type: 'artist', id: artist.id, name: artist.name })}
              className="text-zinc-400 hover:text-zinc-50 transition-colors text-sm"
            >
              Artist radio
            </button>
            <StarButton starred={!!artist.starred} opts={{ artistId: artist.id }} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4">
        <button
          onClick={() => setTab('albums')}
          className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
            tab === 'albums' ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800'
          }`}
        >
          Albums
        </button>
        <button
          onClick={() => setTab('songs')}
          className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
            tab === 'songs' ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800'
          }`}
        >
          Songs
        </button>
      </div>

      {tab === 'albums' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      ) : loadingSongs ? (
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 bg-zinc-800 rounded-md animate-pulse" />
          ))}
        </div>
      ) : allSongs.length === 0 ? (
        <p className="text-zinc-400 text-sm">No songs found.</p>
      ) : (
        <div className="space-y-0.5">
          {allSongs.map((song, i) => (
            <SongRow key={song.id} song={song} queue={allSongs} index={i + 1} showAlbum />
          ))}
        </div>
      )}
    </div>
  );
}
