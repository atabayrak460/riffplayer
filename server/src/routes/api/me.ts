import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/database.js';
import { hashPassword, encryptPassword, verifyPasswordHash } from '../../auth/crypto.js';
import { getOrCreateServerSecret } from '../../auth/seed.js';
import { apiAuth } from './middleware.js';
import { jsonError } from './helpers.js';

export async function mePlugin(app: FastifyInstance): Promise<void> {
  // ── GET /api/v1/users/me ────────────────────────────────────────────────────
  app.get('/users/me', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();
    const user = req.subsonicUser!;
    const prefs = db
      .prepare('SELECT transcode_format, transcode_bitrate, lastfm_session_key, listenbrainz_token FROM user_preferences WHERE user_id = ?')
      .get(user.id) as {
        transcode_format: string | null;
        transcode_bitrate: number | null;
        lastfm_session_key: string | null;
        listenbrainz_token: string | null;
      } | undefined;

    const profile = db
      .prepare('SELECT display_name, bio, avatar_path, avatar_updated_at, show_listening FROM users WHERE id = ?')
      .get(user.id) as { display_name: string | null; bio: string | null; avatar_path: string | null; avatar_updated_at: number | null; show_listening: number };

    reply.send({
      id: user.id,
      username: user.username,
      role: user.role,
      preferences: prefs ?? null,
      profile: {
        displayName: profile.display_name,
        bio: profile.bio,
        hasAvatar: !!profile.avatar_path,
        avatarVersion: profile.avatar_updated_at,
        showListening: profile.show_listening === 1,
      },
    });
  });

  // ── PATCH /api/v1/users/me/preferences ──────────────────────────────────────
  app.patch('/users/me/preferences', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.subsonicUser!.id;
    const body = req.body as Record<string, unknown>;
    const db = getDb();

    const exists = db.prepare('SELECT user_id FROM user_preferences WHERE user_id = ?').get(userId);
    if (!exists) {
      db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(userId);
    }

    const allowed = ['transcode_format', 'transcode_bitrate', 'lastfm_session_key', 'listenbrainz_token'];
    for (const key of allowed) {
      if (key in body) {
        db.prepare(`UPDATE user_preferences SET ${key} = ? WHERE user_id = ?`).run(
          body[key] ?? null,
          userId,
        );
      }
    }
    reply.send({ ok: true });
  });

  // ── PATCH /api/v1/users/me/password — self-service, requires the current
  //    password (unlike admin/users.ts's reset-for-others, which doesn't) ───
  app.patch('/users/me/password', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) return jsonError(reply, 400, 'currentPassword and newPassword required');

    const db = getDb();
    const userId = req.subsonicUser!.id;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string };
    if (!verifyPasswordHash(currentPassword, row.password_hash)) {
      return jsonError(reply, 400, 'Current password is incorrect');
    }

    const secret = getOrCreateServerSecret(db);
    // Bumping token_version invalidates this request's own JWT along with
    // every other session for this user (same as admin/users.ts's password
    // reset) — the client is expected to log the user out right after a
    // successful call, since both this JWT and the stored Subsonic
    // credentials are now stale.
    db.prepare(
      'UPDATE users SET password_hash = ?, subsonic_token = ?, token_version = token_version + 1 WHERE id = ?',
    ).run(hashPassword(newPassword), encryptPassword(newPassword, secret), userId);

    reply.send({ ok: true });
  });

  // ── GET /api/v1/library/stats — for auto-generated page descriptions ───────
  app.get('/library/stats', { preHandler: apiAuth }, async (_req, reply) => {
    const { count } = getDb().prepare('SELECT COUNT(*) AS count FROM tracks').get() as { count: number };
    reply.send({ trackCount: count });
  });
}
