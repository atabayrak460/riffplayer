import type { Song } from '../api/types';

export type QualityTier = 'hires' | 'lossless' | 'lossy' | 'unknown';

export interface AudioQuality {
  tier: QualityTier;
  /** Short badge text ("Hi-Res", "Lossless", "MP3"), or null when nothing is known. */
  label: string | null;
  /** One-line description: "FLAC · 24-bit / 96 kHz · Stereo · 2304 kbps". */
  summary: string;
}

const LOSSLESS_SUFFIXES = new Set(['flac', 'alac', 'wav', 'aiff', 'aif', 'ape', 'wv', 'tta', 'dsf', 'dff']);

// Formats that are always lossy. Anything in neither list (m4a/mp4 can be AAC *or* ALAC) stays
// "unknown" until the server has read the real codec from the file.
const LOSSY_SUFFIXES = new Set(['mp3', 'ogg', 'oga', 'opus', 'aac', 'wma', 'mp2']);

const kHz = (hz: number) => `${Number((hz / 1000).toFixed(1))} kHz`;

function channelsText(n?: number): string | null {
  if (!n) return null;
  if (n === 1) return 'Mono';
  if (n === 2) return 'Stereo';
  return `${n} channels`;
}

/** Classifies a track the way streaming services label quality: Hi-Res = lossless above CD quality
 *  (more than 16 bits or above 48 kHz), Lossless = any other lossless file, otherwise lossy. */
export function audioQuality(song: Song): AudioQuality {
  const suffix = song.suffix?.toLowerCase();
  const lossless =
    song.lossless ??
    (suffix && LOSSLESS_SUFFIXES.has(suffix) ? true : suffix && LOSSY_SUFFIXES.has(suffix) ? false : undefined);

  const parts: string[] = [];
  const name = (song.codec && song.codec.length <= 12 ? song.codec : suffix)?.toUpperCase();
  if (name) parts.push(name);
  if (song.bitDepth && song.samplingRate) parts.push(`${song.bitDepth}-bit / ${kHz(song.samplingRate)}`);
  else if (song.samplingRate) parts.push(kHz(song.samplingRate));
  else if (song.bitDepth) parts.push(`${song.bitDepth}-bit`);
  const ch = channelsText(song.channelCount);
  if (ch) parts.push(ch);
  if (song.bitRate) parts.push(`${song.bitRate} kbps`);
  const summary = parts.join(' · ');

  if (lossless === undefined) return { tier: 'unknown', label: suffix ? suffix.toUpperCase() : null, summary };
  if (!lossless) return { tier: 'lossy', label: suffix ? suffix.toUpperCase() : 'Lossy', summary };

  const hiRes = (song.bitDepth ?? 16) > 16 || (song.samplingRate ?? 44100) > 48000;
  return { tier: hiRes ? 'hires' : 'lossless', label: hiRes ? 'Hi-Res' : 'Lossless', summary };
}

export interface TranscodePrefs {
  transcode_format: string | null;
  transcode_bitrate: number | null;
}

/** Mirrors the server's decision in stream.ts: it converts when the user's preferred format differs
 *  from the file's, or when the file's bitrate is above the user's cap. */
export function willTranscode(song: Song, prefs?: TranscodePrefs | null): { format: string; bitrate: number | null } | null {
  if (!prefs) return null;
  const fmt = prefs.transcode_format?.toLowerCase() || null;
  const cap = prefs.transcode_bitrate && prefs.transcode_bitrate > 0 ? prefs.transcode_bitrate : null;
  const suffix = song.suffix?.toLowerCase();
  const formatChange = !!fmt && fmt !== 'raw' && fmt !== suffix;
  const overCap = !!cap && song.bitRate != null && song.bitRate > cap;
  if (!formatChange && !overCap) return null;
  return { format: fmt && fmt !== 'raw' ? fmt : 'mp3', bitrate: cap };
}

export interface SignalStep {
  stage: 'Source' | 'Delivery' | 'Playback';
  text: string;
  /** True when this step lowers quality (a transcode). */
  degraded?: boolean;
}

/** What happens to the audio between the file on the server and the speakers — honest about what
 *  the app can and cannot know (the browser decides how it is finally mixed and resampled). */
export function signalPath(song: Song, prefs?: TranscodePrefs | null, device = 'this browser'): SignalStep[] {
  const q = audioQuality(song);
  const steps: SignalStep[] = [{ stage: 'Source', text: q.summary || 'Unknown format' }];
  const t = willTranscode(song, prefs);
  if (t) {
    steps.push({
      stage: 'Delivery',
      text: `Converted by the server to ${t.format.toUpperCase()}${t.bitrate ? ` at up to ${t.bitrate} kbps` : ''}`,
      degraded: q.tier === 'hires' || q.tier === 'lossless',
    });
  } else {
    steps.push({ stage: 'Delivery', text: 'Original file, sent unchanged' });
  }
  steps.push({ stage: 'Playback', text: `Decoded on ${device}; the system audio output does the final mixing` });
  return steps;
}

/** Best quality among an album's tracks, for the album header: Hi-Res if any track is, else
 *  Lossless if any is, else the shared lossy format. `count` is how many tracks reach that tier. */
export function albumQuality(songs: Song[]): (AudioQuality & { count: number; total: number }) | null {
  if (songs.length === 0) return null;
  const qualities = songs.map(audioQuality);
  for (const tier of ['hires', 'lossless'] as const) {
    const hits = qualities.filter((q) => q.tier === tier);
    if (hits.length > 0) {
      const best = hits[0];
      const summary = hits.length === songs.length ? best.summary : `${hits.length} of ${songs.length} tracks · ${best.summary}`;
      return { ...best, summary, count: hits.length, total: songs.length };
    }
  }
  const labels = new Set(qualities.map((q) => q.label));
  if (labels.size !== 1) return null; // mixed lossy formats or unknowns: say nothing rather than guess
  const only = qualities[0];
  if (only.tier === 'unknown' || !only.label) return null;
  return { ...only, summary: only.label, count: songs.length, total: songs.length };
}
