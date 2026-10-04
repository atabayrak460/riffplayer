import { useQuery } from '@tanstack/react-query';
import { getRediscover } from '../../api/subsonic';
import { HomeRow } from '../HomeRow';
import { HomeTrackCard } from './HomeTrackCard';

export function RediscoverSection() {
  const { data: songs = [] } = useQuery({ queryKey: ['home-rediscover'], queryFn: getRediscover });

  if (songs.length === 0) return null;

  return (
    <section>
      <h2 className="text-xl font-bold text-zinc-50">Rediscover</h2>
      <p className="text-sm text-zinc-400 mt-1 mb-4">You might have forgotten these.</p>
      <HomeRow title="From your library" viewAllTo="/songs">
        {songs.map((song) => (
          <HomeTrackCard key={song.id} song={song} queue={songs} />
        ))}
      </HomeRow>
    </section>
  );
}
