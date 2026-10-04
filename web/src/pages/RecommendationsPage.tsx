import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRecommendations } from '../api/subsonic';
import { SongRow } from '../components/SongRow';
import { DiscoverCover } from '../components/StockCovers';
import { SystemViewHeader } from '../components/SystemViewHeader';
import type { Song } from '../api/types';

type Tab = 'similar' | 'discover';

export function RecommendationsPage() {
  const [tab, setTab] = useState<Tab>('similar');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['recommendations', tab],
    queryFn: () => getRecommendations(tab),
    retry: false,
  });

  const songs = (data?.songs ?? []) as Song[];
  const source = data?.source;

  const defaultDescription = source
    ? `Suggested by ${source === 'ollama' ? 'local AI (Ollama)' : 'Last.fm'} · from your library only`
    : 'Personalized suggestions from your own library';

  return (
    <div className="p-6">
      <SystemViewHeader
        viewKey="discover"
        title="Discover"
        defaultDescription={defaultDescription}
        StockCover={DiscoverCover}
        meta={songs.length > 0 && `${songs.length} suggestion${songs.length === 1 ? '' : 's'}`}
      />

      {/* Tab selector */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800">
        {(['similar', 'discover'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-brand text-brand'
                : 'border-transparent text-zinc-400 hover:text-zinc-50'
            }`}
          >
            {t === 'similar' ? 'Similar to your taste' : 'Discover weekly'}
          </button>
        ))}
        <button
          onClick={() => refetch()}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-50 transition-colors pb-2"
          title="Refresh suggestions"
        >
          ↻ Refresh
        </button>
      </div>

      {isLoading && (
        <div className="space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-12 bg-zinc-800 rounded animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <div className="bg-zinc-800/60 rounded-lg p-5 text-center">
          <p className="text-sm text-red-400 mb-2">
            {String(error).replace('Error: ', '')}
          </p>
          <p className="text-xs text-zinc-500">
            To enable recommendations, go to Settings → Admin and configure a Last.fm
            API key or an Ollama URL.
          </p>
        </div>
      )}

      {!isLoading && !isError && songs.length === 0 && (
        <div className="text-zinc-400 text-sm text-center py-10">
          No matching tracks found in your library.
          <br />
          <span className="text-xs text-zinc-500">Play more music to improve suggestions.</span>
        </div>
      )}

      {songs.length > 0 && (
        <div className="space-y-0.5">
          {songs.map((song, i) => (
            <SongRow key={song.id} song={song} queue={songs} index={i + 1} showAlbum />
          ))}
        </div>
      )}

      {songs.length > 0 && (
        <p className="text-xs text-zinc-600 mt-6">
          Suggestions are based on your listening history and come exclusively from your own library.
          RiffPlayer never provides links or sources to acquire music.
        </p>
      )}
    </div>
  );
}
