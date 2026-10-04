import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getAllSongs, getGenres, getLibraryStats, type AllSongsSort, type QualityFilter } from '../api/subsonic';
import { QualityFilterSelect } from '../components/QualityFilterSelect';
import { SongRow } from '../components/SongRow';
import { AllSongsCover } from '../components/StockCovers';

const PAGE_SIZE = 200;
// Real row height varies slightly (cover art + text), so this is only the
// virtualizer's initial guess — measureElement (below) corrects it per-row
// against the actual rendered size once mounted.
const ESTIMATED_ROW_HEIGHT = 56;
// How many extra rows to render above/below the visible window, so a fast
// scroll or keyboard nav doesn't show a blank flash before rows mount.
const OVERSCAN = 8;

const SORT_OPTIONS: { value: AllSongsSort; label: string }[] = [
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'added_desc', label: 'Recently added' },
  { value: 'added_asc', label: 'Oldest added' },
];

export function AllSongsPage() {
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState<AllSongsSort>('title');
  const [quality, setQuality] = useState<QualityFilter>('');
  const { data: genres = [] } = useQuery({ queryKey: ['genres'], queryFn: getGenres });
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['all-songs', genre, sort, quality],
    queryFn: ({ pageParam }) => getAllSongs(pageParam, PAGE_SIZE, { genre: genre || undefined, sort, quality: quality || undefined }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
  });
  const { data: stats } = useQuery({ queryKey: ['library-stats'], queryFn: getLibraryStats });

  const songs = data?.pages.flat() ?? [];

  const scrollRef = useRef<HTMLDivElement>(null);
  // One extra "loading" row at the end while there's more to fetch — its
  // presence in the rendered range is what drives the auto-fetch below,
  // replacing the old manual "Load more" button with real
  // scroll-proximity-driven infinite loading.
  const virtualizer = useVirtualizer({
    count: hasNextPage ? songs.length + 1 : songs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index;

  useEffect(() => {
    if (lastVirtualIndex == null) return;
    if (lastVirtualIndex >= songs.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [lastVirtualIndex, hasNextPage, isFetchingNextPage, songs.length, fetchNextPage]);

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center gap-4 mb-6 flex-shrink-0">
        <AllSongsCover className="w-16 h-16 rounded-lg shadow-lg flex-shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">All Songs</h1>
          {stats && (
            <p className="text-sm text-zinc-400 mt-1">
              Every track in your library · {stats.trackCount.toLocaleString()} songs
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <select
            aria-label="Filter by genre"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="bg-zinc-800 text-zinc-200 rounded-md px-2 py-1.5 border border-zinc-700 max-w-[10rem]"
          >
            <option value="">All genres</option>
            {genres.map((g) => (
              <option key={g.value} value={g.value}>
                {g.value} ({g.songCount})
              </option>
            ))}
          </select>
          <QualityFilterSelect value={quality} onChange={setQuality} />
          <select
            aria-label="Sort songs"
            value={sort}
            onChange={(e) => setSort(e.target.value as AllSongsSort)}
            className="bg-zinc-800 text-zinc-200 rounded-md px-2 py-1.5 border border-zinc-700"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-10 bg-zinc-800 rounded-md animate-pulse" />
          ))}
        </div>
      )}

      {isError && <p className="text-red-400 text-sm">Failed to load songs.</p>}

      {!isLoading && !isError && songs.length === 0 && (
        <p className="text-zinc-400 text-sm">{genre || quality
            ? 'No songs match these filters.'
            : 'No songs found. Try indexing your music library.'}</p>
      )}

      {songs.length > 0 && (
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((item) => {
              const song = songs[item.index] as (typeof songs)[number] | undefined;
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
                >
                  {song ? (
                    <SongRow song={song} queue={songs} index={item.index + 1} showAlbum addedAt={song.created} />
                  ) : (
                    <div className="h-10 flex items-center justify-center text-xs text-zinc-500">Loading more…</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
