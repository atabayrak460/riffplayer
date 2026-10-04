import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getArtist } from '../../api/subsonic';
import { CoverArt } from '../CoverArt';
import { CoverLightbox } from '../CoverLightbox';
import { QualityBadge } from '../QualityBadge';
import type { Song } from '../../api/types';

export function HeroSection({ song }: { song: Song }) {
  const [enlarged, setEnlarged] = useState(false);
  // Same query key ArtistDetailPage uses for this artist — shares its cache.
  const { data: artist } = useQuery({
    queryKey: ['artist', song.artistId],
    queryFn: () => getArtist(song.artistId),
  });

  return (
    <div className="p-4">
      <div className="relative aspect-square mb-4 group">
        <Link to={`/albums/${song.albumId}`}>
          <CoverArt
            id={song.coverArt}
            size={400}
            className="w-full h-full object-cover rounded-lg shadow-xl"
            alt={song.album}
          />
        </Link>
        {song.coverArt && (
          <button
            type="button"
            onClick={() => setEnlarged(true)}
            title="Enlarge cover"
            aria-label="Enlarge cover"
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/80 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </button>
        )}
        {artist?.coverArt && (
          <Link
            to={`/artists/${song.artistId}`}
            title={artist.name}
            className="absolute bottom-2 right-2 w-12 h-12 rounded-full ring-2 ring-zinc-950 overflow-hidden shadow-lg hover:scale-105 transition-transform"
          >
            <CoverArt id={artist.coverArt} size={96} className="w-full h-full object-cover" alt={artist.name} />
          </Link>
        )}
      </div>

      {enlarged && song.coverArt && (
        <CoverLightbox coverId={song.coverArt} title={song.album} onClose={() => setEnlarged(false)} />
      )}

      <p className="text-lg font-bold text-zinc-50 truncate">{song.title}</p>
      <QualityBadge song={song} className="mb-1" />
      <Link
        to={`/artists/${song.artistId}`}
        className="text-sm text-zinc-400 hover:text-zinc-50 transition-colors truncate block"
      >
        {song.artist}
      </Link>
      <Link
        to={`/albums/${song.albumId}`}
        className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors truncate block"
      >
        {song.album}
      </Link>
    </div>
  );
}
