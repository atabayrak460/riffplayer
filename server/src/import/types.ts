export type ImportSource = 'spotify' | 'apple_music' | 'lastfm';

/** One listen as found in another service's data. */
export interface ImportedPlay {
  artist: string;
  title: string;
  album: string | null;
  /** Unix seconds. */
  playedAt: number;
  durationMs: number;
}

/** A play counts as a listen after this long, the same threshold Spotify and Last.fm use. */
export const MIN_LISTEN_MS = 30_000;
