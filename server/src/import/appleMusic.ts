import type { ImportedPlay } from './types.js';
import { MIN_LISTEN_MS } from './types.js';

/** Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

function seconds(value: string): number | null {
  if (!value) return null;
  // "20230131" (daily-tracks file) or an ISO timestamp.
  const iso = /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T12:00:00Z` : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Parses an Apple privacy-export CSV: "Apple Music Play Activity.csv" (Song Name, Artist Name,
 * Album Name, Event Start/End Timestamp, Play Duration Milliseconds, Media Duration In
 * Milliseconds) or "Apple Music - Play History Daily Tracks.csv" (Track Description "Artist - Title",
 * Date Played, Play Duration Milliseconds). Returns null when the file is neither.
 */
export function parseAppleMusicCsv(text: string): ImportedPlay[] | null {
  const rows = parseCsv(text);
  if (rows.length === 0) return null;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);

  const song = col('song name');
  const artistCol = col('artist name');
  const description = col('track description');
  if ((song < 0 || artistCol < 0) && description < 0) return null;

  const album = col('album name');
  const start = col('event start timestamp');
  const end = col('event end timestamp');
  const date = col('date played');
  const played = col('play duration milliseconds');
  const media = col('media duration in milliseconds');

  const out: ImportedPlay[] = [];
  for (const r of rows.slice(1)) {
    let title: string;
    let artist: string;
    if (song >= 0 && artistCol >= 0) {
      title = (r[song] ?? '').trim();
      artist = (r[artistCol] ?? '').trim();
    } else {
      const d = (r[description] ?? '').trim();
      const at = d.indexOf(' - ');
      if (at < 0) continue;
      artist = d.slice(0, at).trim();
      title = d.slice(at + 3).trim();
    }
    if (!title || !artist) continue;

    const ms = Number(r[played]) || 0;
    const length = Number(r[media]) || 0;
    // Apple logs a row per start/pause/skip; a real listen is 30 s, or half of a very short track.
    if (ms < MIN_LISTEN_MS && !(length > 0 && length < MIN_LISTEN_MS && ms >= length / 2)) continue;

    const playedAt = seconds(r[start] ?? '') ?? seconds(r[end] ?? '') ?? seconds(r[date] ?? '');
    if (playedAt === null) continue;

    out.push({
      artist,
      title,
      album: album >= 0 && r[album]?.trim() ? r[album].trim() : null,
      playedAt,
      durationMs: ms,
    });
  }
  return out;
}
