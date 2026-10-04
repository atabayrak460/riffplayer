import { usePlayerStore } from '../../store/player';
import { CoverArt } from '../CoverArt';
import type { Song } from '../../api/types';

interface Props {
  song: Song;
  queue: Song[];
}

export function HomeTrackCard({ song, queue }: Props) {
  const playSong = usePlayerStore((s) => s.playSong);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isCurrent = currentSong?.id === song.id;

  return (
    <button onClick={() => playSong(song, queue)} className="group flex flex-col gap-2 text-left w-40 flex-shrink-0">
      <div className="relative aspect-square">
        <CoverArt
          id={song.coverArt}
          size={300}
          className="w-full h-full object-cover rounded-md"
          alt={song.title}
        />
        <div className="absolute bottom-2 right-2 w-10 h-10 bg-brand rounded-full shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-150">
          <svg className="w-5 h-5 text-on-brand ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5.14v14l11-7-11-7z" />
          </svg>
        </div>
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-medium truncate ${isCurrent ? 'text-brand' : 'text-zinc-50'}`}>{song.title}</p>
        <p className="text-xs text-zinc-400 truncate">{song.artist}</p>
      </div>
    </button>
  );
}
