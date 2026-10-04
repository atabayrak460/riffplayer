import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sendOk, sendError, SubsonicErrorCode } from '../response.js';
import { xmlTag, songAttrs, toJson } from '../serialize.js';
import { buildRadio, resolveSeedType, seedArtistIds } from '../../../radio/radio.js';
import { similarLibraryArtistIds } from '../../../radio/similar.js';

type Q = Record<string, string | undefined>;
const p = (req: FastifyRequest) => ({ ...(req.query as Q), ...((req.body as Q) ?? {}) });

// OpenSubsonic getSimilarSongs / getSimilarSongs2: the standard "start radio from this" call, so
// third-party clients (Symfonium, Feishin, …) get RiffPlayer's radio too. `id` may be a song, an
// album or an artist; they share one id counter, so exactly one table can match.
async function similarSongs(req: FastifyRequest, reply: FastifyReply, v2: boolean): Promise<void> {
  const { f, id, count = '50' } = p(req);
  if (!id) return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'id required' });
  const numericId = Number(id);
  const type = Number.isInteger(numericId) ? resolveSeedType(numericId) : null;
  if (!type) return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Item not found' });

  const userId = req.subsonicUser!.id;
  const similarArtistIds = await similarLibraryArtistIds(seedArtistIds(type, numericId, userId));
  const songs = buildRadio({ userId, type, id: numericId, count: Number(count) || 50, similarArtistIds });
  const key = v2 ? 'similarSongs2' : 'similarSongs';
  sendOk(reply, f, {
    xml: xmlTag(key, {}, songs.map((s) => xmlTag('song', songAttrs(s))).join('')),
    json: { [key]: { song: songs.map((s) => toJson(songAttrs(s))) } },
  });
}

export async function radioPlugin(app: FastifyInstance): Promise<void> {
  app.route({ method: ['GET', 'POST'], url: '/getSimilarSongs2.view', handler: (req, reply) => similarSongs(req, reply, true) });
  app.route({ method: ['GET', 'POST'], url: '/getSimilarSongs.view', handler: (req, reply) => similarSongs(req, reply, false) });
}
