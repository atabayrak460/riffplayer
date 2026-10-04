import type { ImportedPlay } from './types.js';
import { MIN_LISTEN_MS } from './types.js';

interface ExtendedEntry {
  ts?: string;
  ms_played?: number;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  master_metadata_album_album_name?: string | null;
}

interface LegacyEntry {
  endTime?: string; // "2023-01-31 18:04" (UTC)
  artistName?: string;
  trackName?: string;
  msPlayed?: number;
}

function toSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Parses one Spotify "Streaming_History_Audio_*.json" (extended history) or legacy
 * "StreamingHistory*.json" file. Podcasts/videos (no track name) and skips under 30 s are dropped.
 */
export function parseSpotifyJson(text: string): ImportedPlay[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const out: ImportedPlay[] = [];
  let recognised = false;
  for (const raw of data as (ExtendedEntry & LegacyEntry)[]) {
    if (!raw || typeof raw !== 'object') continue;
    const extended = 'master_metadata_track_name' in raw || 'ms_played' in raw;
    const legacy = 'trackName' in raw || 'msPlayed' in raw;
    if (!extended && !legacy) continue;
    recognised = true;

    const title = extended ? raw.master_metadata_track_name : raw.trackName;
    const artist = extended ? raw.master_metadata_album_artist_name : raw.artistName;
    const ms = Number(extended ? raw.ms_played : raw.msPlayed) || 0;
    const playedAt = toSeconds(extended ? raw.ts : raw.endTime);
    if (!title || !artist || playedAt === null || ms < MIN_LISTEN_MS) continue;

    out.push({
      artist,
      title,
      album: extended ? (raw.master_metadata_album_album_name ?? null) : null,
      playedAt,
      durationMs: ms,
    });
  }
  return recognised || data.length === 0 ? out : null;
}
