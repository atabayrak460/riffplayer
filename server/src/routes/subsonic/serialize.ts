import path from 'path';

// ── Constants ─────────────────────────────────────────────────────────────────

export const IGNORED_ARTICLES = 'The El La Los Las Le Les';

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  wv: 'audio/x-wavpack',
  ape: 'audio/x-ape',
  mpc: 'audio/x-musepack',
};

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Unix seconds → ISO 8601 */
export function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

// ── File helpers ──────────────────────────────────────────────────────────────

export function fileSuffix(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

export function fileContentType(filePath: string): string {
  return CONTENT_TYPES[fileSuffix(filePath)] ?? 'application/octet-stream';
}

// ── XML helpers ───────────────────────────────────────────────────────────────

type AttrVal = string | number | boolean | undefined | null;

function escAttr(v: AttrVal): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Escape arbitrary text used as an XML tag's text content (not an attribute). */
export function escText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function xmlTag(
  name: string,
  attrs: Record<string, AttrVal> = {},
  children?: string,
): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${escAttr(v)}"`)
    .join(' ');
  const open = a ? `<${name} ${a}` : `<${name}`;
  if (children == null) return `${open}/>`;
  return `${open}>${children}</${name}>`;
}

// ── Alphabet index grouping ───────────────────────────────────────────────────

const ARTICLES = new Set(IGNORED_ARTICLES.toLowerCase().split(' '));

export function indexLetter(name: string): string {
  const words = name.toLowerCase().split(/\s+/);
  const effective = words.length > 1 && ARTICLES.has(words[0]) ? words[1] : words[0];
  const ch = effective.charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

// ── Entity row types (DB → Subsonic) ─────────────────────────────────────────

export interface ArtistRow {
  id: number;
  name: string;
  albumCount: number;
  starred: number | null;
  image_path: string | null;
}

export interface AlbumRow {
  id: number;
  name: string;
  artist_id: number;
  artist_name: string;
  year: number | null;
  image_path: string | null;
  created_at: number;
  songCount: number;
  duration: number;
  starred: number | null;
}

export interface SongRow {
  id: number;
  title: string;
  album_id: number;
  album_name: string;
  artist_id: number;
  artist_name: string;
  track_no: number | null;
  disc_no: number | null;
  year: number | null;
  duration_s: number | null;
  size: number | null;
  bitrate: number | null;
  format: string | null;
  path: string;
  added_at: number;
  starred: number | null;
  replaygain_track: number | null;
  replaygain_album: number | null;
  genre?: string | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  channels?: number | null;
  codec?: string | null;
  lossless?: number | null;
}

// ── Entity serializers ────────────────────────────────────────────────────────

export function artistAttrs(row: ArtistRow): Record<string, AttrVal> {
  return {
    id: String(row.id),
    name: row.name,
    albumCount: row.albumCount,
    starred: row.starred ? isoDate(row.starred) : undefined,
    coverArt: row.image_path ? `ar-${row.id}` : undefined,
  };
}

export function albumAttrs(row: AlbumRow): Record<string, AttrVal> {
  return {
    id: String(row.id),
    name: row.name,
    artist: row.artist_name,
    artistId: String(row.artist_id),
    year: row.year ?? undefined,
    coverArt: `al-${row.id}`,
    starred: row.starred ? isoDate(row.starred) : undefined,
    duration: Math.round(row.duration),
    songCount: row.songCount,
    created: isoDate(row.created_at),
  };
}

export function songAttrs(row: SongRow): Record<string, AttrVal> {
  const suf = fileSuffix(row.path);
  return {
    id: String(row.id),
    title: row.title,
    album: row.album_name,
    albumId: String(row.album_id),
    artist: row.artist_name,
    artistId: String(row.artist_id),
    track: row.track_no ?? undefined,
    discNumber: row.disc_no ?? undefined,
    year: row.year ?? undefined,
    duration: row.duration_s != null ? Math.round(row.duration_s) : undefined,
    size: row.size ?? undefined,
    bitRate: row.bitrate ?? undefined,
    contentType: fileContentType(row.path),
    suffix: suf,
    coverArt: `al-${row.album_id}`,
    path: row.path,
    starred: row.starred ? isoDate(row.starred) : undefined,
    created: isoDate(row.added_at),
    isVideo: false,
    type: 'music',
    genre: row.genre ?? undefined,
    // OpenSubsonic audio-format fields (samplingRate / bitDepth / channelCount),
    // plus codec and lossless as non-standard extras (clients ignore unknown keys).
    samplingRate: row.sample_rate ?? undefined,
    bitDepth: row.bit_depth ?? undefined,
    channelCount: row.channels ?? undefined,
    codec: row.codec ?? undefined,
    lossless: row.lossless == null ? undefined : Boolean(row.lossless),
    // OpenSubsonic ReplayGain extension (flat fields; clients may ignore)
    replayGainTrackGain: row.replaygain_track ?? undefined,
    replayGainAlbumGain: row.replaygain_album ?? undefined,
  };
}

/** Strip undefined from an attr map for JSON payloads */
export function toJson(attrs: Record<string, AttrVal>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v != null));
}
