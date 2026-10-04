import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/database.js';
import { songAttrs, toJson, type SongRow } from '../subsonic/serialize.js';
import { SONG_SELECT_LIST, SONG_FROM } from '../subsonic/endpoints/browse.js';
import {
  ConnectHub, parseCommand, parseDeviceType, parseStateReport, sanitizeName, validDeviceId,
  type ResolvedSong,
} from '../../connect/hub.js';
import { createSseSink, attachCleanup } from '../../connect/sse.js';

// RiffPlayer Connect: lets one user's devices see each other, mirror what is playing and control
// it. The logic lives in connect/hub.ts; this file is the HTTP surface (SSE stream, long-poll
// fallback and the POST endpoints). Design: docs/CONNECT-DESIGN.md.

// Read at call time (not import time) so tests can shorten them.
const heartbeatMs = () => Number(process.env.RIFFPLAYER_CONNECT_HEARTBEAT_MS) || 20_000;
// Housekeeping granularity: transfer deadlines and the unreachable grace period are checked this often.
const tickMs = () => Number(process.env.RIFFPLAYER_CONNECT_TICK_MS) || 1_000;
const pollHoldMs = () => Number(process.env.RIFFPLAYER_CONNECT_POLL_HOLD_MS) || 25_000;
// How often an open stream re-checks that its token is still valid before delivering an event.
const revokeCheckMs = () => {
  const v = process.env.RIFFPLAYER_CONNECT_REVOKE_CHECK_MS;
  return v !== undefined && v !== '' ? Number(v) : 1_000;
};

// The small JSON bodies (command, transfer, rename) never need more than this; /state has its own larger limit.
const SMALL_BODY = 8 * 1024;

const SQLITE_CHUNK = 500;

function resolveSongs(userId: number, ids: string[]): ResolvedSong[] {
  const numeric = [...new Set(ids.filter((id) => /^\d+$/.test(id)))];
  const db = getDb();
  const out: ResolvedSong[] = [];
  for (let i = 0; i < numeric.length; i += SQLITE_CHUNK) {
    const chunk = numeric.slice(i, i + SQLITE_CHUNK);
    const rows = db
      .prepare(`SELECT ${SONG_SELECT_LIST} ${SONG_FROM} WHERE t.id IN (${chunk.map(() => '?').join(',')})`)
      .all(userId, ...chunk) as SongRow[];
    for (const row of rows) {
      out.push({
        id: String(row.id),
        durationMs: row.duration_s != null ? Math.round(row.duration_s * 1000) : null,
        json: toJson(songAttrs(row)),
      });
    }
  }
  return out;
}

/** The user's current token_version, or undefined if the account no longer exists. */
function tokenVersion(userId: number): number | undefined {
  const row = getDb().prepare('SELECT token_version FROM users WHERE id = ?').get(userId) as
    { token_version: number } | undefined;
  return row?.token_version;
}

const bad = (reply: FastifyReply, message: string) => reply.code(400).send({ error: message });

function deviceIdFrom(body: unknown): string | null {
  const id = (body as Record<string, unknown> | null)?.deviceId;
  return validDeviceId(id) ? id : null;
}

const DEVICE_ID_HELP = 'deviceId required (8-64 characters: letters, digits, "-" and "_")';

export async function connectPlugin(app: FastifyInstance): Promise<void> {
  const hub = new ConnectHub({ resolveSongs });

  const ticker = setInterval(() => hub.tick(), tickMs());
  ticker.unref();
  // preClose (not onClose): app.close() waits for open connections before it runs onClose hooks, and
  // an SSE stream never ends on its own — so the streams have to be ended *before* that wait begins.
  app.addHook('preClose', async () => {
    clearInterval(ticker);
    hub.shutdown();
  });

  // ── SSE stream ──────────────────────────────────────────────────────────
  // fetch()-based clients (not EventSource) because the stream is authenticated with a Bearer header.
  app.get('/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.subsonicUser!.id;
    const q = req.query as Record<string, string | undefined>;
    if (!validDeviceId(q.deviceId)) return bad(reply, DEVICE_ID_HELP);
    const info = { deviceId: q.deviceId, name: sanitizeName(q.name), type: parseDeviceType(q.type) };

    const versionAtConnect = tokenVersion(userId);
    if (versionAtConnect === undefined) return reply.code(401).send({ error: 'Unauthorized' });

    // From here we write the response ourselves and keep it open.
    reply.hijack();
    const raw = reply.raw;
    let started = false;
    let heartbeat: NodeJS.Timeout | undefined;
    let connId = 0;

    // Has this connection's token been revoked (password change, account removed)? Checked at most once a
    // second, before every delivery, so a revoked stream receives nothing more than "revoked".
    let lastCheck = 0;
    let stale = false;
    const isStale = () => {
      const now = Date.now();
      if (now - lastCheck >= revokeCheckMs()) {
        lastCheck = now;
        stale = tokenVersion(userId) !== versionAtConnect;
      }
      return stale;
    };

    const inner = createSseSink(raw, {
      isStale,
      onStale: () => {
        // During connect the connection has no id yet: say so and let the next delivery try again.
        if (connId === 0) return false;
        hub.revokeConnection(userId, info.deviceId, connId);
        return true;
      },
      onEnd: () => { if (heartbeat) clearInterval(heartbeat); },
    });
    // The status line and headers go out with the first event, so a refused connection can still get a real HTTP status.
    const sink = {
      send(seq: number, event: Parameters<typeof inner.send>[1]) {
        if (!started) {
          started = true;
          raw.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            // Tell nginx-style proxies (and Cloudflare) not to hold chunks back.
            'X-Accel-Buffering': 'no',
            'X-Content-Type-Options': 'nosniff',
          });
          raw.write('retry: 3000\n\n');
        }
        inner.send(seq, event);
      },
      end: () => inner.end(),
    };
    // A socket error must never become an uncaught exception.
    raw.on('error', () => {});

    const conn = hub.connectStream(userId, info, sink);
    if (!conn.ok) {
      raw.writeHead(429, { 'Content-Type': 'application/json' });
      raw.end(JSON.stringify({ error: conn.reason }));
      return;
    }
    connId = conn.connId;

    // Heartbeat keeps proxies from timing the stream out, and re-checks the token even while nothing is
    // being sent (a password change bumps token_version, which must close streams opened with the old token).
    heartbeat = setInterval(() => {
      if (tokenVersion(userId) !== versionAtConnect) {
        hub.revokeConnection(userId, info.deviceId, connId);
        return;
      }
      if (!raw.writableEnded && !raw.destroyed) {
        try {
          raw.write(': ping\n\n');
        } catch {
          // a dead socket is cleaned up by the close handler below
        }
      }
    }, heartbeatMs());

    attachCleanup(req.raw, () => {
      if (heartbeat) clearInterval(heartbeat);
      hub.disconnect(userId, info.deviceId, connId);
    });
  });

  // ── Long-poll fallback (for paths that buffer streams) ──────────────────
  app.get('/poll', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.subsonicUser!.id;
    const q = req.query as Record<string, string | undefined>;
    if (!validDeviceId(q.deviceId)) return bad(reply, DEVICE_ID_HELP);
    let since: number | undefined;
    if (q.since !== undefined) {
      since = Number(q.since);
      if (!Number.isInteger(since) || since < 0) return bad(reply, 'since must be a non-negative integer');
    }
    const info = { deviceId: q.deviceId, name: sanitizeName(q.name), type: parseDeviceType(q.type) };

    const r = await hub.pollEvents(userId, info, since, pollHoldMs());
    if (!r.ok) return reply.code(429).send({ error: r.reason });
    return { events: r.events.map((e) => ({ seq: e.seq, event: e.event.name, data: e.event.data })) };
  });

  // ── Reads ───────────────────────────────────────────────────────────────
  app.get('/state', async (req: FastifyRequest) => hub.snapshot(req.subsonicUser!.id));

  app.get('/queue', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hub.allowQueueRead(req.subsonicUser!.id)) return reply.code(429).send({ error: 'rate_limited' });
    const queue = hub.queue(req.subsonicUser!.id);
    if (!queue) return reply.code(404).send({ error: 'nothing_playing' });
    return queue;
  });

  // ── Writes ──────────────────────────────────────────────────────────────
  app.post('/state', { bodyLimit: 256 * 1024 }, async (req: FastifyRequest, reply: FastifyReply) => {
    const deviceId = deviceIdFrom(req.body);
    if (!deviceId) return bad(reply, DEVICE_ID_HELP);
    const report = parseStateReport(req.body);
    if (typeof report === 'string') return bad(reply, report);

    const r = hub.reportState(req.subsonicUser!.id, deviceId, report);
    if (r.ok) return { accepted: true, takeover: r.takeover === true };
    switch (r.reason) {
      // Not an error: this device just isn't the one playing (any more).
      case 'not_active': return { accepted: false, reason: 'not_active' };
      case 'need_queue': return reply.code(409).send({ error: 'need_queue' });
      case 'unknown_device': return reply.code(409).send({ error: 'unknown_device' });
      case 'rate_limited': return reply.code(429).send({ error: 'rate_limited' });
    }
  });

  app.post('/command', { bodyLimit: SMALL_BODY }, async (req: FastifyRequest, reply: FastifyReply) => {
    const deviceId = deviceIdFrom(req.body);
    if (!deviceId) return bad(reply, DEVICE_ID_HELP);
    const cmd = parseCommand(req.body);
    if (typeof cmd === 'string') return bad(reply, cmd);
    // The device the sender saw playing: the command is refused if another one has taken over since.
    const target = (req.body as Record<string, unknown>).targetDeviceId;
    if (target !== undefined && !validDeviceId(target)) return bad(reply, 'targetDeviceId is not a valid device id');

    const r = hub.sendCommand(req.subsonicUser!.id, deviceId, cmd, target);
    if (r.ok) return reply.code(202).send({ delivered: true, duplicate: r.duplicate === true });
    if (r.reason === 'rate_limited') return reply.code(429).send({ error: 'rate_limited' });
    if (r.reason === 'no_valid_songs') return bad(reply, 'none of the songs exist');
    return reply.code(409).send({ error: r.reason });
  });

  app.post('/transfer', { bodyLimit: SMALL_BODY }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const deviceId = deviceIdFrom(body);
    if (!deviceId || !validDeviceId(body.toDeviceId)) return bad(reply, `${DEVICE_ID_HELP}; toDeviceId required too`);
    if (body.play !== undefined && typeof body.play !== 'boolean') return bad(reply, 'play must be a boolean');

    const r = hub.transfer(req.subsonicUser!.id, deviceId, body.toDeviceId, body.play !== false);
    if (r.ok) return reply.code(r.status === 'pending' ? 202 : 200).send({ status: r.status });
    switch (r.reason) {
      case 'target_offline': return reply.code(404).send({ error: r.reason });
      case 'rate_limited': return reply.code(429).send({ error: r.reason });
      default: return reply.code(409).send({ error: r.reason });
    }
  });

  app.patch('/device', { bodyLimit: SMALL_BODY }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const deviceId = deviceIdFrom(body);
    if (!deviceId) return bad(reply, DEVICE_ID_HELP);
    const hasName = typeof body.name === 'string';
    const hasOutput = body.output === null || typeof body.output === 'string';
    if (!hasName && !hasOutput) return bad(reply, 'name or output required');
    const userId = req.subsonicUser!.id;
    // A device may rename itself, and/or tell the others where its sound comes out ('' or null = its own speaker).
    const results = [
      hasName ? hub.rename(userId, deviceId, body.name as string) : 'ok',
      hasOutput ? hub.setOutput(userId, deviceId, (body.output as string | null) || null) : 'ok',
    ];
    if (results.includes('unknown_device')) return reply.code(404).send({ error: 'unknown_device' });
    if (results.includes('rate_limited')) return reply.code(429).send({ error: 'rate_limited' });
    return { ok: true };
  });
}
