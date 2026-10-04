import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/database.js';
import { parseExport } from '../../import/file.js';
import { fetchLastFmYear, LastFmImportError } from '../../import/lastfm.js';
import { importPlays, importSummary, deleteImported } from '../../import/store.js';
import type { ImportSource } from '../../import/types.js';

const MAX_UPLOAD = 150 * 1024 * 1024;
const SOURCES: ImportSource[] = ['spotify', 'apple_music', 'lastfm'];

/**
 * Bring listening history from other services in so Wrapped covers the whole year.
 * Only the user's own history is stored (names + times); nothing here fetches or provides audio.
 */
export async function importHistoryPlugin(app: FastifyInstance): Promise<void> {
  // GET /api/v1/import/history — what has been imported so far, per source
  app.get('/history', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ sources: importSummary(req.subsonicUser!.id) });
  });

  // POST /api/v1/import/history/file — a Spotify or Apple Music export (.zip, .json or .csv)
  app.post('/history/file', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const data = await req.file({ limits: { fileSize: MAX_UPLOAD } });
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });
    const buffer = await data.toBuffer().catch(() => null);
    if (!buffer || data.file.truncated) return reply.code(413).send({ error: 'The file is too large (150 MB max)' });

    let parsed;
    try {
      parsed = parseExport(data.filename, buffer);
    } catch {
      return reply.code(400).send({ error: 'That archive could not be read' });
    }
    if (!parsed)
      return reply.code(400).send({
        error: 'Not a recognised export. Use the Spotify "Extended streaming history" files or the Apple Music "Play Activity" CSV.',
      });

    const result = importPlays(req.subsonicUser!.id, parsed.source, parsed.plays);
    reply.send({ source: parsed.source, files: parsed.files, ...result });
  });

  // POST /api/v1/import/history/lastfm { username, year } — a public Last.fm profile
  app.post('/history/lastfm', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { username?: string; year?: number };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const year = Number(body.year) || new Date().getFullYear();
    if (!/^[A-Za-z0-9_-]{2,15}$/.test(username))
      return reply.code(400).send({ error: 'Enter a valid Last.fm username' });
    if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear())
      return reply.code(400).send({ error: 'Invalid year' });

    const key = (getDb().prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get() as { value: string } | undefined)?.value;
    if (!key) return reply.code(503).send({ error: 'The admin has not configured a Last.fm API key (Admin → Settings)' });

    try {
      const { plays, truncated } = await fetchLastFmYear(username, key, year);
      const result = importPlays(req.subsonicUser!.id, 'lastfm', plays);
      reply.send({ source: 'lastfm', files: 1, truncated, ...result });
    } catch (e) {
      if (e instanceof LastFmImportError) return reply.code(e.status).send({ error: e.message });
      return reply.code(502).send({ error: 'Could not reach Last.fm' });
    }
  });

  // DELETE /api/v1/import/history[?source=spotify] — remove imported history (all, or one source)
  app.delete('/history', async (req: FastifyRequest, reply: FastifyReply) => {
    const source = (req.query as { source?: string }).source;
    if (source !== undefined && !SOURCES.includes(source as ImportSource))
      return reply.code(400).send({ error: 'Unknown source' });
    reply.send({ removed: deleteImported(req.subsonicUser!.id, source as ImportSource | undefined) });
  });
}
