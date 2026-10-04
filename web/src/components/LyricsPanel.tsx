import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLyrics } from '../api/subsonic';
import { usePlayerStore } from '../store/player';

interface Props {
  onClose: () => void;
  /** Renders to fill its parent instead of as its own fixed floating panel —
   *  used when hosted inside the full-screen expanded player, which already
   *  provides its own fixed/full-screen chrome and backdrop. */
  embedded?: boolean;
}

/** Elements marked with this attribute (the player bars, the expanded
 *  player) don't count as an "outside" click — using the player controls,
 *  including the lyrics toggle itself, shouldn't dismiss the lyrics. */
const KEEP_OPEN_SELECTOR = '[data-lyrics-keep-open]';

export function LyricsPanel({ onClose, embedded = false }: Props) {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seek = usePlayerStore((s) => s.seek);
  const activeLyricRef = useRef<HTMLParagraphElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const { data: lyrics, isLoading, isError } = useQuery({
    queryKey: ['lyrics', currentSong?.id],
    queryFn: () => (currentSong ? getLyrics(currentSong.id) : null),
    enabled: !!currentSong,
  });

  // Find the active lyric line
  const lines = lyrics?.line ?? [];
  let activeIdx = -1;
  if (lyrics?.synced) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].start <= currentTime * 1000) activeIdx = i;
      else break;
    }
  }

  // Auto-scroll to active line
  useEffect(() => {
    if (autoScroll && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIdx, autoScroll]);

  // The standalone view closes on Escape or a click anywhere outside it.
  useEffect(() => {
    if (embedded) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || panelRef.current?.contains(target)) return;
      if (target.closest(KEEP_OPEN_SELECTOR)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [embedded, onClose]);

  return (
      <div
        ref={panelRef}
        className={embedded
          ? 'w-full h-full bg-zinc-950/95 backdrop-blur-md flex flex-col'
          : 'absolute inset-0 z-10 bg-zinc-950 flex flex-col'}
        onWheel={() => setAutoScroll(false)}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-shrink-0">
          <div>
            <p className="text-sm font-semibold text-zinc-50">{currentSong?.title ?? 'Lyrics'}</p>
            <p className="text-xs text-zinc-400">{currentSong?.artist}</p>
          </div>
          <div className="flex items-center gap-3">
            {!autoScroll && (
              <button
                onClick={() => setAutoScroll(true)}
                className="text-xs text-brand hover:underline"
              >
                Auto-scroll
              </button>
            )}
            {!embedded && (
              <button onClick={onClose} className="text-zinc-400 hover:text-zinc-50 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Lyrics body */}
        <div className="flex-1 overflow-y-auto">
        <div className={embedded ? 'px-5 py-6 space-y-3' : 'max-w-3xl mx-auto px-8 py-10 space-y-5'}>
          {!currentSong && (
            <p className="text-zinc-500 text-center text-sm">Nothing playing.</p>
          )}
          {currentSong && isLoading && (
            <p className="text-zinc-500 text-center text-sm">Loading lyrics…</p>
          )}
          {currentSong && isError && (
            <p className="text-zinc-500 text-center text-sm">Lyrics unavailable.</p>
          )}
          {currentSong && !isLoading && !isError && !lyrics && (
            <p className="text-zinc-500 text-center text-sm">No lyrics found for this track.</p>
          )}
          {lyrics &&
            lines.map((line, i) => {
              const isActive = i === activeIdx;
              const size = embedded ? 'text-lg' : 'text-2xl md:text-3xl font-bold';
              const className = `${size} leading-relaxed transition-all duration-300 ${
                isActive
                  ? 'text-zinc-50 font-semibold scale-105 origin-left'
                  : embedded ? 'text-zinc-500' : 'text-zinc-600'
              }`;
              // Synced lines jump playback to their timestamp on click, and
              // resume auto-scroll so the view follows the new position.
              if (lyrics.synced) {
                return (
                  <p key={i} ref={isActive ? activeLyricRef : null}>
                    <button
                      type="button"
                      onClick={() => { seek(line.start / 1000); setAutoScroll(true); }}
                      className={`${className} block w-full text-left hover:text-zinc-50`}
                    >
                      {line.value || ' '}
                    </button>
                  </p>
                );
              }
              return (
                <p key={i} className={className}>
                  {line.value || ' '}
                </p>
              );
            })}
        </div>
        </div>
      </div>
  );
}
