import { createReadStream } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/database.js';
import { apiAuth } from './middleware.js';
import { getCoversDir, jsonError } from './helpers.js';
import { MAX_BIO, MAX_DISPLAY_NAME, cleanText, getProfile, listPeople, socialEnabled } from '../../social/social.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const AVATAR_SIZE = 256;

const disabled = (reply: FastifyReply) => jsonError(reply, 403, 'Social features are turned off on this server');

export async function socialPlugin(app: FastifyInstance): Promise<void> {
  // ── what the client needs to know before showing anything ──
  app.get('/social/status', { preHandler: apiAuth }, async (_req, reply) => {
    reply.send({ enabled: socialEnabled() });
  });

  // ── people on this server ──
  app.get('/social/people', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!socialEnabled()) return disabled(reply);
    reply.send({ people: listPeople(req.subsonicUser!.id) });
  });

  app.get('/social/people/:id', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!socialEnabled()) return disabled(reply);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return jsonError(reply, 400, 'Invalid user id');
    const profile = getProfile(id, req.subsonicUser!.id);
    if (!profile) return jsonError(reply, 404, 'No such person');
    reply.send({ profile });
  });

  // ── avatars ──
  app.get('/social/avatar/:id', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return jsonError(reply, 400, 'Invalid user id');
    // Your own picture is always yours to see; other people's only while social features are on.
    if (id !== req.subsonicUser!.id && !socialEnabled()) return disabled(reply);
    const row = getDb().prepare('SELECT avatar_path FROM users WHERE id = ?').get(id) as { avatar_path: string | null } | undefined;
    if (!row?.avatar_path) return jsonError(reply, 404, 'No avatar');
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'private, max-age=86400') // clients add ?v=<avatarVersion>
      .send(createReadStream(row.avatar_path));
  });

  app.post('/users/me/avatar', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const data = await req.file();
    if (!data) return jsonError(reply, 400, 'No file uploaded');
    if (!IMAGE_TYPES.has(data.mimetype)) return jsonError(reply, 400, 'Unsupported image type');

    let jpeg: Buffer;
    try {
      // One normalised, metadata-free JPEG whatever was uploaded: EXIF (including GPS) is dropped, the
      // orientation is applied, and the pixel count is capped so a decompression bomb can't hurt.
      jpeg = await sharp(await data.toBuffer(), { limitInputPixels: 50_000_000 })
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch {
      return jsonError(reply, 400, 'That file is not a usable image');
    }

    const userId = req.subsonicUser!.id;
    const dir = getCoversDir();
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `av-${userId}.jpg`);
    await writeFile(file, jpeg);
    getDb().prepare('UPDATE users SET avatar_path = ?, avatar_updated_at = unixepoch() WHERE id = ?').run(file, userId);
    reply.send({ ok: true });
  });

  app.delete('/users/me/avatar', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.subsonicUser!.id;
    const row = getDb().prepare('SELECT avatar_path FROM users WHERE id = ?').get(userId) as { avatar_path: string | null };
    if (row.avatar_path) await rm(row.avatar_path, { force: true });
    getDb().prepare('UPDATE users SET avatar_path = NULL, avatar_updated_at = NULL WHERE id = ?').run(userId);
    reply.send({ ok: true });
  });

  // ── my own profile ──
  app.patch('/users/me/profile', { preHandler: apiAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = req.subsonicUser!.id;
    const db = getDb();

    if ('displayName' in body) {
      if (body.displayName !== null && typeof body.displayName !== 'string') return jsonError(reply, 400, 'displayName must be text');
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(cleanText(body.displayName, MAX_DISPLAY_NAME), userId);
    }
    if ('bio' in body) {
      if (body.bio !== null && typeof body.bio !== 'string') return jsonError(reply, 400, 'bio must be text');
      db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(cleanText(body.bio, MAX_BIO), userId);
    }
    if ('showListening' in body) {
      if (typeof body.showListening !== 'boolean') return jsonError(reply, 400, 'showListening must be true or false');
      db.prepare('UPDATE users SET show_listening = ? WHERE id = ?').run(body.showListening ? 1 : 0, userId);
    }
    reply.send({ ok: true });
  });
}
