import type { Song } from '../api/types';
import { audioQuality, type AudioQuality, type QualityTier } from '../lib/quality';

const STYLES: Record<QualityTier, string> = {
  hires: 'bg-brand text-on-brand',
  lossless: 'border border-brand text-brand',
  lossy: 'border border-zinc-600 text-zinc-400',
  unknown: 'border border-zinc-700 text-zinc-500',
};

/** Small format chip ("Hi-Res", "Lossless", "MP3"); nothing at all when the format is unknown.
 *  Give it a `song`, or an already-computed `quality` (e.g. an album's best). */
export function QualityBadge({ song, quality, className = '' }: { song?: Song; quality?: AudioQuality | null; className?: string }) {
  const q = quality ?? (song ? audioQuality(song) : null);
  if (!q) return null;
  if (!q.label) return null;
  return (
    <span
      title={q.summary || undefined}
      data-quality={q.tier}
      className={`inline-block flex-shrink-0 rounded px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wide ${STYLES[q.tier]} ${className}`}
    >
      {q.label}
    </span>
  );
}
