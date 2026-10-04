import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/database.js';
import { getLastFmRecommendations } from '../../recommendations/lastfm.js';
import { getOllamaRecommendations, generateWrappedSummary } from '../../recommendations/ollama.js';
import { getWrappedStats } from '../../recommendations/wrapped.js';
import { generateWeek, getWeekly, weekStart } from '../../recommendations/weekly.js';
import { songAttrs, toJson, type SongRow } from '../subsonic/serialize.js';

function getSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function jsonError(reply: FastifyReply, code: number, message: string): void {
  reply.code(code).send({ error: message });
}

export async function recommendationsPlugin(app: FastifyInstance): Promise<void> {

  // ── GET /api/v1/recommendations/similar ────────────────────────────────────
  // Last.fm similar-artist recommendations from the user's local library.
  app.get('/similar', async (req: FastifyRequest, reply: FastifyReply) => {
    if (getSetting('recommendations_enabled') === 'false')
      return jsonError(reply, 403, 'Recommendations are disabled');

    const apiKey = getSetting('lastfm_api_key');
    if (!apiKey)
      return jsonError(reply, 503, 'Last.fm API key not configured (Admin → Settings)');

    const userId = req.subsonicUser!.id;
    const songs = await getLastFmRecommendations(userId, apiKey);

    reply.send({
      songs: songs.map((s) => toJson(songAttrs(s))),
      source: 'lastfm',
      note: 'All tracks are from your own library.',
    });
  });

  // ── GET /api/v1/recommendations/discover ───────────────────────────────────
  // Ollama (if configured) or Last.fm discover mix.
  app.get('/discover', async (req: FastifyRequest, reply: FastifyReply) => {
    if (getSetting('recommendations_enabled') === 'false')
      return jsonError(reply, 403, 'Recommendations are disabled');

    const userId = req.subsonicUser!.id;
    const ollamaUrl = getSetting('ollama_url');
    const ollamaModel = getSetting('ollama_model') ?? 'llama3.2';

    let songs: SongRow[];
    let source: string;

    if (ollamaUrl) {
      songs = await getOllamaRecommendations(userId, ollamaUrl, ollamaModel);
      source = 'ollama';
    } else {
      const apiKey = getSetting('lastfm_api_key');
      if (!apiKey)
        return jsonError(reply, 503, 'Configure Last.fm API key or Ollama URL (Admin → Settings)');
      songs = await getLastFmRecommendations(userId, apiKey);
      source = 'lastfm';
    }

    reply.send({
      songs: songs.map((s) => toJson(songAttrs(s))),
      source,
      note: 'All tracks are from your own library. No external sources.',
    });
  });

  // ── GET /api/v1/recommendations/weekly ─────────────────────────────────────
  // This week's discovery list: artists and tracks that are NOT in the library, as names only
  // (never a link or a source). Built the first time it is asked for in a week, then kept.
  app.get('/weekly', async (req: FastifyRequest, reply: FastifyReply) => {
    if (getSetting('recommendations_enabled') === 'false')
      return jsonError(reply, 403, 'Recommendations are disabled');
    reply.send(await getWeekly(req.subsonicUser!.id));
  });

  // ── POST /api/v1/recommendations/weekly/refresh ────────────────────────────
  // Build this week's list again (new picks), e.g. after the user has played more music.
  app.post('/weekly/refresh', { config: { rateLimit: { max: 6, timeWindow: '1 hour' } } }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (getSetting('recommendations_enabled') === 'false')
      return jsonError(reply, 403, 'Recommendations are disabled');
    reply.send(await generateWeek(req.subsonicUser!.id, weekStart()));
  });

  // ── GET /api/v1/recommendations/wrapped ────────────────────────────────────
  // Year-end Wrapped stats. ?year=2024 (defaults to current year).
  app.get('/wrapped', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.subsonicUser!.id;
    const year = Number((req.query as Record<string, string>).year)
      || new Date().getFullYear();

    const stats = getWrappedStats(userId, year);
    reply.send(stats);
  });

  // ── POST /api/v1/recommendations/wrapped/summary ───────────────────────────
  // Generate an Ollama narrative for the Wrapped stats.
  app.post('/wrapped/summary', async (req: FastifyRequest, reply: FastifyReply) => {
    const ollamaUrl = getSetting('ollama_url');
    const ollamaModel = getSetting('ollama_model') ?? 'llama3.2';

    if (!ollamaUrl)
      return jsonError(reply, 503, 'Ollama URL not configured (Admin → Settings)');

    const userId = req.subsonicUser!.id;
    const year = Number((req.query as Record<string, string>).year)
      || new Date().getFullYear();

    const stats = getWrappedStats(userId, year);
    if (stats.totalPlays === 0)
      return jsonError(reply, 404, 'No play history for this year');

    const summary = await generateWrappedSummary(
      {
        year: stats.year,
        totalPlays: stats.totalPlays,
        totalMinutes: stats.totalMinutes,
        topArtists: stats.topArtists.map((a) => ({
          name: a.name,
          playCount: a.playCount,
        })),
        topTracks: stats.topTracks.map((t) => ({
          title: t.title,
          artist: t.artist,
          playCount: t.playCount,
        })),
      },
      ollamaUrl,
      ollamaModel,
    );

    reply.send({ summary });
  });
}
