import { Link } from 'react-router-dom';
import { useArtistSongs } from '../../lib/useArtistSongs';
import { SongRow } from '../SongRow';
import type { Song } from '../../api/types';

const CAP = 8;

export function ArtistTracksSection({ song }: { song: Song }) {
  const { songs } = useArtistSongs(song.artistId);
  const others = songs.filter((t) => t.id !== song.id);
  if (others.length === 0) return null;

  const shown = others.slice(0, CAP);

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">More from this artist</h3>
        {others.length > CAP && (
          <Link
            to={`/artists/${song.artistId}?tab=songs`}
            className="text-xs text-zinc-400 hover:text-zinc-50 transition-colors"
          >
            See all
          </Link>
        )}
      </div>
      <div className="space-y-0.5">
        {shown.map((track) => (
          <SongRow
            key={track.id}
            song={track}
            queue={others}
            index={others.findIndex((t) => t.id === track.id) + 1}
            condensed
            condensedSubtitle={track.album}
          />
        ))}
      </div>
    </div>
  );
}
