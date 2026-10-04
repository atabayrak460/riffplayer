import type { TrackCredits } from '../api/subsonic';

const LABELS: [keyof TrackCredits, string][] = [
  ['albumArtist', 'Album artist'],
  ['artists', 'Artists'],
  ['composers', 'Composer'],
  ['lyricists', 'Lyrics'],
  ['writers', 'Written by'],
  ['producers', 'Producer'],
  ['conductors', 'Conductor'],
  ['arrangers', 'Arranger'],
  ['engineers', 'Engineer'],
  ['mixers', 'Mixer'],
  ['remixers', 'Remixer'],
  ['djMixers', 'DJ mixer'],
  ['labels', 'Label'],
  ['catalogNumbers', 'Catalogue no.'],
  ['isrc', 'ISRC'],
  ['releaseDate', 'Released'],
  ['originalYear', 'Original year'],
  ['bpm', 'BPM'],
  ['key', 'Key'],
  ['mood', 'Mood'],
  ['copyright', 'Copyright'],
];

/** Credits as display rows ("Composer" → "A, B"), in a fixed order, skipping anything empty. */
export function creditRows(credits: TrackCredits | undefined): [string, string][] {
  if (!credits) return [];
  const rows: [string, string][] = [];
  for (const [key, label] of LABELS) {
    const value = credits[key];
    if (value == null) continue;
    const text = Array.isArray(value) ? value.join(', ') : String(value);
    if (text) rows.push([label, text]);
  }
  return rows;
}
