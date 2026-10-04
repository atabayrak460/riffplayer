import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { getOrCreateServerSecret } from '../../auth/seed.js';
import { hashPassword, encryptPassword } from '../../auth/crypto.js';
import { seedLibrary, authParams } from '../subsonic/helpers.js';

let app: FastifyInstance;
let tmpDir: string;
let ids: ReturnType<typeof seedLibrary>;
const auth = authParams();

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'riffplayer-share-'));
  process.env.COVERS_DIR = path.join(tmpDir, 'cache');
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  ids = seedLibrary(getDb());
});

afterEach(async () => {
  delete process.env.COVERS_DIR;
  await app.close();
  closeDb();
  await rm(tmpDir, { recursive: true });
});

async function redCover(): Promise<string> {
  const file = path.join(tmpDir, 'cover.png');
  await writeFile(file, await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 220, g: 20, b: 20 } } }).png().toBuffer());
  getDb().prepare('UPDATE albums SET cover_path = ? WHERE id = ?').run(file, ids.albumId);
  return file;
}

let songCounter = 0;
function addSongs(count: number): number[] {
  const db = getDb();
  return Array.from({ length: count }, (_, i) =>
    Number(
      db.prepare(
        `INSERT INTO tracks (title, album_id, artist_id, track_no, duration_s, path, size, format, bitrate)
         VALUES (?, ?, ?, ?, 100, ?, 1, 'MPEG', 128)`,
      ).run(`Song ${i}`, ids.albumId, ids.artistId, i + 10, `/music/share-${songCounter++}.mp3`).lastInsertRowid,
    ),
  );
}

function makePlaylist(trackIds: number[], opts: { ownerId?: number; isPublic?: number } = {}): number {
  const db = getDb();
  const owner = opts.ownerId ?? 1;
  const id = Number(
    db.prepare('INSERT INTO playlists (owner_id, name, description, is_public) VALUES (?, ?, ?, ?)')
      .run(owner, 'Share me', 'A playlist for testing', opts.isPublic ?? 0).lastInsertRowid,
  );
  trackIds.forEach((t, i) => db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(id, t, i));
  return id;
}

const get = (url: string, qs = auth) => app.inject({ url: `/api/v1/share/${url}${url.includes('?') ? '&' : '?'}${qs}` });

describe('GET /api/v1/share/song/:id', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ url: `/api/v1/share/song/${ids.trackId}` });
    expect(res.statusCode).toBe(401);
  });

  it('returns a 1080×1920 PNG (story) by default', async () => {
    const res = await get(`song/${ids.trackId}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    const meta = await sharp(res.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1080, 1920]);
  });

  it('size=post gives the 4:5 feed format', async () => {
    const meta = await sharp((await get(`song/${ids.trackId}?size=post`)).rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
  });

  it('takes its background colours from the cover', async () => {
    await redCover();
    const { data, info } = await sharp((await get(`song/${ids.trackId}`)).rawPayload).raw().toBuffer({ resolveWithObject: true });
    const i = (60 * info.width + 540) * info.channels; // top area, above the cover
    expect(data[i]).toBeGreaterThan(data[i + 1] + 20); // red clearly dominates green
    expect(data[i]).toBeGreaterThan(data[i + 2] + 20);
  });

  it('copes with hostile and very long text', async () => {
    getDb().prepare('UPDATE tracks SET title = ? WHERE id = ?').run(`<b>${'x'.repeat(5000)}</b> & "quotes" \u0007\u001b[31m`, ids.trackId);
    const res = await get(`song/${ids.trackId}`);
    expect(res.statusCode).toBe(200);
    expect((await sharp(res.rawPayload).metadata()).height).toBe(1920);
  });

  it('works for a track whose album has no cover art', async () => {
    expect((await get(`song/${ids.trackId}`)).statusCode).toBe(200);
  });

  it('404s for an unknown song and 400s for a bad id', async () => {
    expect((await get('song/999999')).statusCode).toBe(404);
    expect((await get('song/abc')).statusCode).toBe(400);
  });

  it('serves a repeat request from the cache (same bytes)', async () => {
    const a = await get(`song/${ids.trackId}`);
    const b = await get(`song/${ids.trackId}`);
    expect(b.rawPayload.equals(a.rawPayload)).toBe(true);
  });

  it('draws a new picture after the song is retitled', async () => {
    const a = await get(`song/${ids.trackId}`);
    getDb().prepare("UPDATE tracks SET title = 'A completely different title' WHERE id = ?").run(ids.trackId);
    const b = await get(`song/${ids.trackId}`);
    expect(b.rawPayload.equals(a.rawPayload)).toBe(false);
  });
});

describe('GET /api/v1/share/playlist/:id', () => {
  it('a short playlist needs one page, a long one several', async () => {
    const short = makePlaylist(addSongs(5));
    expect((await get(`playlist/${short}/pages`)).json()).toEqual({ pages: 1, songs: 5 });

    const long = makePlaylist(addSongs(40));
    const body = (await get(`playlist/${long}/pages`)).json() as { pages: number; songs: number };
    expect(body.songs).toBe(40);
    expect(body.pages).toBeGreaterThan(1);
  });

  it('renders each page as a 1080×1920 PNG and 404s past the last one', async () => {
    const id = makePlaylist(addSongs(40));
    const { pages } = (await get(`playlist/${id}/pages`)).json() as { pages: number };
    for (let n = 1; n <= pages; n++) {
      const res = await get(`playlist/${id}/page/${n}`);
      expect(res.statusCode, `page ${n}`).toBe(200);
      expect((await sharp(res.rawPayload).metadata()).height).toBe(1920);
    }
    expect((await get(`playlist/${id}/page/${pages + 1}`)).statusCode).toBe(404);
    expect((await get(`playlist/${id}/page/0`)).statusCode).toBe(400);
  });

  it('pages differ from one another', async () => {
    const id = makePlaylist(addSongs(40));
    const one = await get(`playlist/${id}/page/1`);
    const two = await get(`playlist/${id}/page/2`);
    expect(two.rawPayload.equals(one.rawPayload)).toBe(false);
  });

  it('an empty playlist still renders its header page', async () => {
    const id = makePlaylist([]);
    expect((await get(`playlist/${id}/pages`)).json()).toEqual({ pages: 1, songs: 0 });
    expect((await get(`playlist/${id}/page/1`)).statusCode).toBe(200);
  });

  it('another user can open a public playlist but not a private one', async () => {
    const db = getDb();
    const secret = getOrCreateServerSecret(db);
    const other = Number(
      db.prepare("INSERT INTO users (username, password_hash, subsonic_token, role) VALUES ('regular', ?, ?, 'user')")
        .run(hashPassword('pw'), encryptPassword('pw', secret)).lastInsertRowid,
    );
    const asOther = authParams('pw').replace('u=admin', 'u=regular');
    const tracks = addSongs(2);
    const priv = makePlaylist(tracks, { ownerId: 1, isPublic: 0 });
    const pub = makePlaylist(tracks, { ownerId: 1, isPublic: 1 });
    expect(other).not.toBe(1);

    expect((await get(`playlist/${priv}/pages`, asOther)).statusCode).toBe(404);
    expect((await get(`playlist/${priv}/page/1`, asOther)).statusCode).toBe(404);
    expect((await get(`playlist/${pub}/pages`, asOther)).statusCode).toBe(200);
    expect((await get(`playlist/${pub}/page/1`, asOther)).statusCode).toBe(200);
  });

  it('404s for an unknown playlist', async () => {
    expect((await get('playlist/999999/pages')).statusCode).toBe(404);
  });
});
