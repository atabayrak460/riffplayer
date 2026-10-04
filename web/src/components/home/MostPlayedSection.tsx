import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMostPlayed, getPlaylists, deletePlaylist } from '../../api/subsonic';
import { HomeRow } from '../HomeRow';
import { HomeTrackCard } from './HomeTrackCard';
import { PlaylistCard } from '../PlaylistCard';

export function MostPlayedSection() {
  const qc = useQueryClient();
  const { data: songs = [] } = useQuery({ queryKey: ['home-most-played'], queryFn: getMostPlayed });
  // Same query key PlaylistsPage/Sidebar use, so this shares their cache.
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: getPlaylists });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePlaylist(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  });

  if (songs.length === 0 && playlists.length === 0) return null;

  const topSongs = songs.slice(0, 10);

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-bold text-zinc-50">Most Played</h2>

      {topSongs.length > 0 && (
        <HomeRow title="Your most played" viewAllTo="/most-played">
          {topSongs.map((song) => (
            <HomeTrackCard key={song.id} song={song} queue={topSongs} />
          ))}
        </HomeRow>
      )}

      {playlists.length > 0 && (
        <HomeRow title="Your playlists" viewAllTo="/playlists">
          {playlists.map((pl) => (
            <div key={pl.id} className="w-40 flex-shrink-0">
              <PlaylistCard pl={pl} onDelete={() => deleteMutation.mutate(pl.id)} />
            </div>
          ))}
        </HomeRow>
      )}
    </section>
  );
}
