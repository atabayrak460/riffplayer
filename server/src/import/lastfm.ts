import type { ImportedPlay } from './types.js';

const MAX_PAGES = 300; // 200 scrobbles per page → 60 000 per import

interface RecentTrack {
  name?: string;
  artist?: { '#text'?: string; name?: string };
  album?: { '#text'?: string };
  date?: { uts?: string };
  '@attr'?: { nowplaying?: string };
}

export class LastFmImportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Reads a user's public scrobbles for a year through user.getRecentTracks. The profile must be
 * public (Last.fm's own setting). Last.fm has no durations, so the caller fills those in.
 */
export async function fetchLastFmYear(
  username: string,
  apiKey: string,
  year: number,
): Promise<{ plays: ImportedPlay[]; truncated: boolean }> {
  const from = Math.floor(Date.UTC(year, 0, 1) / 1000);
  const to = Math.floor(Date.UTC(year + 1, 0, 1) / 1000) - 1;
  const plays: ImportedPlay[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const params = new URLSearchParams({
      method: 'user.getrecenttracks',
      user: username,
      api_key: apiKey,
      format: 'json',
      limit: '200',
      from: String(from),
      to: String(to),
      page: String(page),
    });
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, { signal: AbortSignal.timeout(15000) });
    const data = (await res.json().catch(() => ({}))) as {
      error?: number;
      message?: string;
      recenttracks?: { track?: RecentTrack[] | RecentTrack; '@attr'?: { totalPages?: string } };
    };
    if (data.error === 6) throw new LastFmImportError('Last.fm user not found', 404);
    if (data.error === 17) throw new LastFmImportError('This Last.fm profile is private. Make listening history public in Last.fm privacy settings, then try again.', 403);
    if (data.error === 10 || data.error === 26) throw new LastFmImportError('The Last.fm API key is not valid', 503);
    if (!res.ok || data.error || !data.recenttracks) throw new LastFmImportError(data.message ?? 'Last.fm request failed', 502);

    totalPages = Number(data.recenttracks['@attr']?.totalPages) || 1;
    const tracks = data.recenttracks.track;
    for (const t of Array.isArray(tracks) ? tracks : tracks ? [tracks] : []) {
      if (t['@attr']?.nowplaying) continue;
      const artist = t.artist?.['#text'] ?? t.artist?.name;
      const playedAt = Number(t.date?.uts);
      if (!t.name || !artist || !playedAt) continue;
      plays.push({ artist, title: t.name, album: t.album?.['#text'] || null, playedAt, durationMs: 0 });
    }
    page++;
  }
  return { plays, truncated: totalPages > MAX_PAGES };
}
