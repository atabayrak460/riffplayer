import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/database.js';
import { signToken } from '../../auth/jwt.js';
import { decryptPassword, verifyPasswordHash } from '../../auth/crypto.js';
import { getOrCreateServerSecret } from '../../auth/seed.js';
import { jsonError } from './helpers.js';
import { apiAuth } from './middleware.js';
import { approvePairing, pollPairing, startPairing } from '../../auth/devicePairing.js';
import { generateApiKey, hashApiKey } from '../../auth/crypto.js';

export async function authPlugin(app: FastifyInstance): Promise<void> {
  // ── POST /api/v1/auth/login — exchange credentials for a JWT ───────────────
  app.post('/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password)
      return jsonError(reply, 400, 'username and password required');

    const db = getDb();
    const user = db
      .prepare('SELECT id, username, role, subsonic_token, password_hash, token_version FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as
      { id: number; username: string; role: string; subsonic_token: string | null; password_hash: string; token_version: number } | undefined;

    if (!user) return jsonError(reply, 401, 'Wrong username or password');

    // Verify via decrypted subsonic_token or a dedicated hash
    let valid = false;
    if (user.subsonic_token) {
      try {
        const secret = getOrCreateServerSecret(db);
        const plain = decryptPassword(user.subsonic_token, secret);
        valid = plain === password;
      } catch {
        valid = false;
      }
    }
    // Also try bcrypt hash (future-proof)
    if (!valid) {
      valid = verifyPasswordHash(password, user.password_hash);
    }

    if (!valid) return jsonError(reply, 401, 'Wrong username or password');

    const token = signToken(user);
    reply.send({ token, user: { id: user.id, username: user.username, role: user.role } });
  });

  // ── Linking a TV (or another keyboard-less device), see auth/devicePairing.ts ──

  // POST /api/v1/auth/device-code — the device asks for a code to show on its screen. No login needed.
  app.post('/auth/device-code', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const name = ((req.body ?? {}) as { deviceName?: unknown }).deviceName;
    const deviceName = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 40) || 'TV' : 'TV';
    reply.send(startPairing(deviceName));
  });

  // POST /api/v1/auth/device-approve — a signed-in user types the code the device shows.
  app.post('/auth/device-approve', {
    preHandler: apiAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const code = ((req.body ?? {}) as { userCode?: unknown }).userCode;
    if (typeof code !== 'string' || code.length < 4 || code.length > 20) return jsonError(reply, 400, 'userCode required');
    const approved = approvePairing(code, { userId: req.subsonicUser!.id });
    if (!approved) return jsonError(reply, 404, 'That code is wrong or has expired');
    reply.send({ ok: true, deviceName: approved.deviceName });
  });

  // POST /api/v1/auth/device-token — the device polls with its secret code until approved.
  app.post('/auth/device-token', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const deviceCode = ((req.body ?? {}) as { deviceCode?: unknown }).deviceCode;
    if (typeof deviceCode !== 'string' || deviceCode.length < 16 || deviceCode.length > 200) return jsonError(reply, 400, 'deviceCode required');
    const result = pollPairing(deviceCode);
    if (result.status === 'pending') return reply.code(202).send({ status: 'pending' });
    if (result.status === 'expired') return jsonError(reply, 410, 'This code has expired — ask the device for a new one');

    const db = getDb();
    const user = db
      .prepare('SELECT id, username, role, token_version FROM users WHERE id = ?')
      .get(result.approval.userId) as { id: number; username: string; role: string; token_version: number } | undefined;
    if (!user) return jsonError(reply, 410, 'The account no longer exists');

    // An API key instead of the password: it only opens this server's API, can be listed and revoked by
    // the user, and the password never reaches the TV.
    const apiKey = generateApiKey();
    db.prepare('INSERT INTO api_keys (user_id, key_hash, name) VALUES (?, ?, ?)').run(user.id, hashApiKey(apiKey), `Linked: ${result.deviceName}`);
    reply.send({ status: 'approved', token: signToken(user), apiKey, user: { id: user.id, username: user.username, role: user.role } });
  });

  // ── Linked devices: see and unlink what has been paired ──
  app.get('/users/me/linked-devices', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const rows = getDb()
      .prepare("SELECT id, name, created_at AS createdAt, last_used AS lastUsed FROM api_keys WHERE user_id = ? AND name LIKE 'Linked: %' ORDER BY created_at DESC")
      .all(req.subsonicUser!.id) as { id: number; name: string; createdAt: number; lastUsed: number | null }[];
    reply.send({ devices: rows.map((r) => ({ id: r.id, name: r.name.replace(/^Linked: /, ''), createdAt: r.createdAt, lastUsed: r.lastUsed })) });
  });

  app.delete('/users/me/linked-devices/:id', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return jsonError(reply, 400, 'Invalid id');
    const res = getDb().prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ? AND name LIKE 'Linked: %'").run(id, req.subsonicUser!.id);
    if (res.changes === 0) return jsonError(reply, 404, 'No such linked device');
    reply.send({ ok: true });
  });
}
