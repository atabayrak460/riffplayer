import { useEffect, useState } from 'react';
import { star, unstar } from '../api/subsonic';
import { useFavoritesStore, selectStarred, type FavoriteType } from '../store/favorites';

interface Props {
  starred: boolean;
  onToggle?: (nowStarred: boolean) => void;
  opts: { id?: string; albumId?: string; artistId?: string };
  className?: string;
}

function target(opts: Props['opts']): { type: FavoriteType; id: string } {
  if (opts.id) return { type: 'track', id: opts.id };
  if (opts.albumId) return { type: 'album', id: opts.albumId };
  return { type: 'artist', id: opts.artistId! };
}

export function StarButton({ starred: initialStarred, onToggle, opts, className = '' }: Props) {
  const { type, id } = target(opts);
  const hydrate = useFavoritesStore((s) => s.hydrate);
  const setGlobalStarred = useFavoritesStore((s) => s.setStarred);
  const storedStarred = useFavoritesStore(selectStarred(type, id));
  const starred = storedStarred ?? initialStarred;
  const [loading, setLoading] = useState(false);

  // Seed the shared store from this component's known value the first time
  // this item is seen — later toggles anywhere in the app take precedence.
  useEffect(() => {
    hydrate(type, id, initialStarred);
  }, [type, id, initialStarred, hydrate]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    const next = !starred;
    setGlobalStarred(type, id, next); // optimistic — updates every instance immediately
    try {
      if (next) await star(opts); else await unstar(opts);
      onToggle?.(next);
    } catch {
      setGlobalStarred(type, id, !next); // revert on failure
    } finally {
      setLoading(false);
    }
  };

  const label = starred ? 'Remove from favourites' : 'Add to favourites';

  return (
    <button
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`text-zinc-400 hover:text-brand transition-colors ${starred ? 'text-brand' : ''} ${className}`}
    >
      <svg className="w-5 h-5" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
      </svg>
    </button>
  );
}
