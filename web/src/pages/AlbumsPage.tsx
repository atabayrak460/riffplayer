import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAlbumList, type QualityFilter } from '../api/subsonic';
import { QualityFilterSelect } from '../components/QualityFilterSelect';
import { AlbumCard } from '../components/AlbumCard';
import { CoverFlow } from '../components/CoverFlow';
import { useUiStyleStore } from '../store/uiStyle';

const TYPES = [
  { value: 'newest', label: 'Recently Added' },
  { value: 'recent', label: 'Recently Played' },
  { value: 'frequent', label: 'Most Played' },
  { value: 'starred', label: 'Starred' },
  { value: 'alphabeticalByName', label: 'A–Z' },
  { value: 'alphabeticalByArtist', label: 'By Artist' },
  { value: 'random', label: 'Random' },
] as const;

export function AlbumsPage() {
  const [type, setType] = useState<string>('newest');
  const [quality, setQuality] = useState<QualityFilter>('');
  // Cover Flow is the iPod Classic style's way of browsing; anyone can switch to it.
  const defaultView = useUiStyleStore((s) => s.style) === 'ipod' ? 'coverflow' : 'grid';
  const [chosenView, setChosenView] = useState<'grid' | 'coverflow' | null>(null);
  const view = chosenView ?? defaultView;

  const { data: albums = [], isLoading, isError } = useQuery({
    queryKey: ['albums', type, quality],
    queryFn: () => getAlbumList(type, quality ? { size: 100, quality } : { size: 100 }),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-50">Albums</h1>
        <div className="flex items-center gap-3">
        <div role="group" aria-label="View" className="flex rounded-lg border border-zinc-700 overflow-hidden text-sm">
          {([['grid', 'Grid'], ['coverflow', 'Cover Flow']] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setChosenView(v)}
              className={`px-3 py-1.5 ${view === v ? 'bg-brand text-on-brand' : 'text-zinc-400 hover:text-zinc-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <QualityFilterSelect value={quality} onChange={setQuality} />
        <select
          aria-label="Sort albums"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-sm text-zinc-50 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand"
        >
          {TYPES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="aspect-square bg-zinc-800 rounded-md animate-pulse" />
              <div className="h-3 bg-zinc-800 rounded animate-pulse w-3/4" />
              <div className="h-3 bg-zinc-800 rounded animate-pulse w-1/2" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <p className="text-red-400 text-sm">Failed to load albums.</p>
      )}

      {!isLoading && !isError && albums.length === 0 && (
        <p className="text-zinc-400 text-sm">No albums found. Try indexing your music library.</p>
      )}

      {view === 'coverflow' ? (
        <CoverFlow albums={albums} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      )}
    </div>
  );
}
