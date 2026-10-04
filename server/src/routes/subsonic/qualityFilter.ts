// Optional `quality` filter shared by search3 (songs) and getAlbumList2 (albums),
// a RiffPlayer extension that stock Subsonic clients simply never send.
//   lossless → lossless files (includes Hi-Res)
//   hires    → lossless files above CD quality (more than 16 bits or above 48 kHz)
// The conditions are fixed strings looked up from a whitelist — never built from input —
// and refer to a `tracks` row aliased `t`. Tracks scanned before migration 015 have
// lossless = NULL and don't match until the next scan fills it in.
const CONDITIONS: Record<string, string> = {
  lossless: 't.lossless = 1',
  hires: 't.lossless = 1 AND (t.bit_depth > 16 OR t.sample_rate > 48000)',
};

/** The SQL condition for a `quality` request value, or null for none/unknown. */
export function qualityCondition(quality: string | undefined): string | null {
  return quality && Object.hasOwn(CONDITIONS, quality) ? CONDITIONS[quality] : null;
}
