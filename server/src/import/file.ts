import { unzipSync, strFromU8 } from 'fflate';
import { parseSpotifyJson } from './spotify.js';
import { parseAppleMusicCsv } from './appleMusic.js';
import type { ImportedPlay, ImportSource } from './types.js';

export interface ParsedExport {
  source: ImportSource;
  plays: ImportedPlay[];
  files: number;
}

const MAX_UNZIPPED = 400 * 1024 * 1024;

function collect(
  name: string,
  data: Uint8Array,
  out: { name: string; text: string }[],
  budget: { left: number },
  depth: number,
): void {
  const isZip = data.length > 3 && data[0] === 0x50 && data[1] === 0x4b;
  if (!isZip) {
    out.push({ name, text: strFromU8(data) });
    return;
  }
  if (depth > 2) return;
  const files = unzipSync(data, {
    filter: (f) => {
      budget.left -= f.originalSize;
      if (budget.left < 0) throw new Error('Archive is too large');
      return /\.(json|csv|zip)$/i.test(f.name) && !f.name.includes('__MACOSX');
    },
  });
  // Apple's export is a zip that contains another zip holding the CSV files.
  for (const [inner, bytes] of Object.entries(files)) collect(inner, bytes, out, budget, depth + 1);
}

/** Reads an uploaded export: a .zip as downloaded from Spotify/Apple, or a single .json/.csv. */
export function parseExport(filename: string, data: Buffer): ParsedExport | null {
  const entries: { name: string; text: string }[] = [];
  collect(filename, new Uint8Array(data), entries, { left: MAX_UNZIPPED }, 0);

  let source: ImportSource | null = null;
  const plays: ImportedPlay[] = [];
  let files = 0;
  for (const e of entries) {
    const asSpotify = /\.json$/i.test(e.name) ? parseSpotifyJson(e.text) : null;
    if (asSpotify && (source === null || source === 'spotify')) {
      source = 'spotify';
      plays.push(...asSpotify);
      files++;
      continue;
    }
    const asApple = /\.csv$/i.test(e.name) ? parseAppleMusicCsv(e.text) : null;
    if (asApple && (source === null || source === 'apple_music')) {
      source = 'apple_music';
      plays.push(...asApple);
      files++;
    }
  }
  return source && files > 0 ? { source, plays, files } : null;
}
