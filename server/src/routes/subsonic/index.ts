import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendOk, sendError, SubsonicErrorCode } from './response.js';
import { subsonicAuth } from '../../auth/preHandler.js';
import { browsePlugin } from './endpoints/browse.js';
import { searchPlugin } from './endpoints/search.js';
import { favoritesPlugin } from './endpoints/favorites.js';
import { playlistsPlugin } from './endpoints/playlists.js';
import { streamPlugin } from './endpoints/stream.js';
import { coverArtPlugin } from './endpoints/coverArt.js';
import { scrobblePlugin } from './endpoints/scrobble.js';
import { lyricsPlugin } from './endpoints/lyrics.js';
import { scanPlugin } from './endpoints/scan.js';
import { playQueuePlugin } from './endpoints/playQueue.js';
import { radioPlugin } from './endpoints/radio.js';

interface SubsonicQuery {
  f?: string;
}

export async function subsonicPlugin(app: FastifyInstance): Promise<void> {
  // ping is intentionally unauthenticated — clients use it to test connectivity
  app.route({
    method: ['GET', 'POST'],
    url: '/ping.view',
    handler: (request: FastifyRequest<{ Querystring: SubsonicQuery }>, reply: FastifyReply) => {
      sendOk(reply, request.query.f);
    },
  });

  // All other Subsonic endpoints require auth
  app.register(async (api) => {
    api.addHook('preHandler', subsonicAuth);

    api.register(browsePlugin);
    api.register(searchPlugin);
    api.register(favoritesPlugin);
    api.register(playlistsPlugin);
    api.register(streamPlugin);
    api.register(coverArtPlugin);
    api.register(scrobblePlugin);
    api.register(lyricsPlugin);
    api.register(scanPlugin);
    api.register(playQueuePlugin);
    api.register(radioPlugin);

    // Catch-all for unrecognised endpoints — returns a proper Subsonic error
    // instead of a raw Fastify 404. Must be registered last in this scope.
    api.all('*', (request: FastifyRequest<{ Querystring: SubsonicQuery }>, reply: FastifyReply) => {
      sendError(reply, request.query.f, {
        code: SubsonicErrorCode.DATA_NOT_FOUND,
        message: 'Unknown or unimplemented endpoint',
      });
    });
  });
}
