import { parseFile } from 'music-metadata';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/database.js';
import { jsonError } from './helpers.js';

const MAX_ENTRIES = 50;
const MAX_LENGTH = 200;

/** Tag text is untrusted: drop control characters and cap lengths before it reaches any client. */
function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, MAX_LENGTH) : null;
}

function list(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    const text = clean(v);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

export interface TrackCredits {
  albumArtist?: string;
  artists?: string[];
  composers?: string[];
  lyricists?: string[];
  writers?: string[];
  producers?: string[];
  conductors?: string[];
  arrangers?: string[];
  engineers?: string[];
  mixers?: string[];
  remixers?: string[];
  djMixers?: string[];
  labels?: string[];
  catalogNumbers?: string[];
  isrc?: string[];
  copyright?: string;
  releaseDate?: string;
  originalYear?: number;
  bpm?: number;
  key?: string;
  mood?: string;
}

export async function tracksPlugin(app: FastifyInstance): Promise<void> {
  // GET /api/v1/tracks/:id/credits — who made the track, read from the file's own tags on demand
  // (nothing is stored, so it works for the whole existing library without a rescan).
  app.get('/:id/credits', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return jsonError(reply, 400, 'Invalid track id');

    const track = getDb().prepare('SELECT path FROM tracks WHERE id = ?').get(id) as { path: string } | undefined;
    if (!track) return jsonError(reply, 404, 'Track not found');

    let common;
    try {
      ({ common } = await parseFile(track.path, { skipCovers: true, duration: false }));
    } catch {
      return jsonError(reply, 404, 'The file could not be read');
    }

    const credits: TrackCredits = {};
    const set = <K extends keyof TrackCredits>(key: K, value: TrackCredits[K] | null | undefined) => {
      if (value == null) return;
      if (Array.isArray(value) && value.length === 0) return;
      credits[key] = value;
    };

    set('albumArtist', clean(common.albumartist) ?? undefined);
    const artists = list(common.artists);
    // A single artist that equals the album artist isn't worth repeating.
    if (artists.length > 1 || (artists.length === 1 && artists[0] !== credits.albumArtist)) set('artists', artists);
    set('composers', list(common.composer));
    set('lyricists', list(common.lyricist));
    set('writers', list(common.writer));
    set('producers', list(common.producer));
    set('conductors', list(common.conductor));
    set('arrangers', list(common.arranger));
    set('engineers', list(common.engineer));
    set('mixers', list(common.mixer));
    set('remixers', list(common.remixer));
    set('djMixers', list(common.djmixer));
    set('labels', list(common.label));
    set('catalogNumbers', list(common.catalognumber));
    set('isrc', list(common.isrc));
    set('copyright', clean(common.copyright) ?? undefined);
    set('releaseDate', clean(common.releasedate) ?? undefined);
    if (typeof common.originalyear === 'number') set('originalYear', common.originalyear);
    if (typeof common.bpm === 'number' && common.bpm > 0) set('bpm', Math.round(common.bpm));
    set('key', clean(common.key) ?? undefined);
    set('mood', clean(common.mood) ?? undefined);

    reply.send({ credits });
  });
}
