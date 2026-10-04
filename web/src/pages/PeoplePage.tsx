import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPeople, getSocialStatus } from '../api/subsonic';
import { Avatar } from '../components/Avatar';

export function PeoplePage() {
  const { data: enabled, isLoading: statusLoading } = useQuery({ queryKey: ['social-status'], queryFn: getSocialStatus });
  const { data: people = [], isLoading, isError } = useQuery({
    queryKey: ['people'],
    queryFn: getPeople,
    enabled: enabled === true,
    refetchInterval: 30_000, // "now listening" changes as songs play
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-zinc-50 mb-6">People</h1>

      {!statusLoading && enabled === false && (
        <p className="text-sm text-zinc-400">Social features are turned off on this server.</p>
      )}
      {(statusLoading || isLoading) && enabled !== false && <div className="h-20 bg-zinc-800 rounded-lg animate-pulse" />}
      {isError && <p className="text-sm text-red-400">Couldn&apos;t load the people on this server.</p>}

      <ul className="grid gap-3 sm:grid-cols-2">
        {people.map((p) => (
          <li key={p.id}>
            <Link to={`/people/${p.id}`} className="flex items-center gap-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg p-3 transition-colors">
              <Avatar userId={p.id} name={p.displayName} hasAvatar={p.hasAvatar} version={p.avatarVersion} size={56} />
              <div className="min-w-0">
                <p className="font-semibold text-zinc-50 truncate">
                  {p.displayName}
                  {p.isMe && <span className="ml-2 text-xs font-normal text-zinc-500">you</span>}
                </p>
                {p.nowListening ? (
                  <p className="text-sm text-brand truncate">
                    Listening to {p.nowListening.title} — {p.nowListening.artist}
                  </p>
                ) : p.bio ? (
                  <p className="text-sm text-zinc-400 truncate">{p.bio}</p>
                ) : null}
                <p className="text-xs text-zinc-500">
                  {p.publicPlaylistCount} public {p.publicPlaylistCount === 1 ? 'playlist' : 'playlists'}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
