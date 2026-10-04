import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildRadio, seedArtistIds, type RadioSeedType } from '../../radio/radio.js';
import { similarLibraryArtistIds } from '../../radio/similar.js';
import { songAttrs, toJson } from '../subsonic/serialize.js';
import { jsonError } from './helpers.js';

const TYPES: RadioSeedType[] = ['song', 'artist', 'album', 'playlist'];
const MAX_EXCLUDE = 500;

export async function radioPlugin(app: FastifyInstance): Promise<void> {
  // GET /api/v1/radio?type=song|artist|album|playlist&id=…&count=30&exclude=1,2,3
  // A batch of songs for an endless "radio" queue. Clients call it again (passing what is already
  // queued as `exclude`) when the queue runs low.
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { type?: string; id?: string; count?: string; exclude?: string };
    const type = q.type as RadioSeedType;
    const id = Number(q.id);
    if (!TYPES.includes(type) || !Number.isInteger(id) || id <= 0) return jsonError(reply, 400, 'type and id are required');
    const count = Math.min(Math.max(Number(q.count) || 30, 1), 100);
    const exclude = (q.exclude ?? '')
      .split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_EXCLUDE);

    const userId = req.subsonicUser!.id;
    const similarArtistIds = await similarLibraryArtistIds(seedArtistIds(type, id, userId));
    const songs = buildRadio({ userId, type, id, count, exclude, similarArtistIds });
    reply.send({ songs: songs.map((s) => toJson(songAttrs(s))) });
  });
}
