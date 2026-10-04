import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPerson } from '../api/subsonic';
import { Avatar } from '../components/Avatar';
import { PlaylistCard } from '../components/PlaylistCard';

export function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const { data: person, isLoading, isError } = useQuery({
    queryKey: ['person', id],
    queryFn: () => getPerson(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="p-6"><div className="h-32 bg-zinc-800 rounded-lg animate-pulse" /></div>;
  if (isError || !person) {
    return (
      <div className="p-6">
        <p className="text-sm text-zinc-400">Couldn&apos;t find that person. <Link to="/people" className="text-brand">Back to People</Link></p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-5 mb-8">
        <Avatar userId={person.id} name={person.displayName} hasAvatar={person.hasAvatar} version={person.avatarVersion} size={96} />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-zinc-50 truncate">{person.displayName}</h1>
          <p className="text-sm text-zinc-500">@{person.username}</p>
          {person.bio && <p className="text-sm text-zinc-300 mt-2 whitespace-pre-wrap break-words">{person.bio}</p>}
          {person.nowListening && (
            <p className="text-sm text-brand mt-2">Listening to {person.nowListening.title} — {person.nowListening.artist}</p>
          )}
        </div>
      </div>

      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">
        {person.isMe ? 'Your playlists' : 'Public playlists'}
      </h2>
      {person.playlists.length === 0 ? (
        <p className="text-sm text-zinc-400">{person.isMe ? 'You have no playlists yet.' : 'No public playlists.'}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {person.playlists.map((pl) => (
            <PlaylistCard key={pl.id} pl={pl} onDelete={() => undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
