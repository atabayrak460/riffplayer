import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { getOrCreateServerSecret } from '../../auth/seed.js';
import { hashPassword, encryptPassword } from '../../auth/crypto.js';
import { seedLibrary, authParams } from '../subsonic/helpers.js';
import { cleanText } from '../../social/social.js';

// Loosely typed JSON from the API — the tests assert on the pieces they care about.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function multipart(filename: string, mimeType: string, data: Buffer): { body: Buffer; contentType: string } {
  const boundary = '----riffplayerSocialBoundary';
  const preamble = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  return { body: Buffer.concat([preamble, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}

let app: FastifyInstance;
let tmpDir: string;
let ids: ReturnType<typeof seedLibrary>;
let bob: number; // a second member
const admin = authParams(); // user 1
const asBob = () => authParams('pw').replace('u=admin', 'u=bob');

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'riffplayer-social-'));
  process.env.COVERS_DIR = path.join(tmpDir, 'covers');
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  ids = seedLibrary(getDb());
  const db = getDb();
  const secret = getOrCreateServerSecret(db);
  bob = Number(
    db.prepare("INSERT INTO users (username, password_hash, subsonic_token, role) VALUES ('bob', ?, ?, 'user')")
      .run(hashPassword('pw'), encryptPassword('pw', secret)).lastInsertRowid,
  );
});

afterEach(async () => {
  delete process.env.COVERS_DIR;
  await app.close();
  closeDb();
  await rm(tmpDir, { recursive: true });
});

const get = (url: string, qs = admin) => app.inject({ url: `/api/v1/${url}${url.includes('?') ? '&' : '?'}${qs}` });
const patch = (url: string, payload: unknown, qs = admin) => app.inject({ method: 'PATCH', url: `/api/v1/${url}?${qs}`, payload: payload as object });
const people = async (qs = admin) => ((await get('social/people', qs)).json() as { people: Json[] }).people;

function play(userId: number, secondsAgo: number) {
  getDb().prepare('INSERT INTO play_history (user_id, track_id, played_at) VALUES (?, ?, ?)')
    .run(userId, ids.trackId, Math.floor(Date.now() / 1000) - secondsAgo); // the seeded track is 210 s long
}

describe('authentication', () => {
  it('everything needs a login', async () => {
    for (const url of ['social/status', 'social/people', `social/people/${bob}`, `social/avatar/${bob}`]) {
      expect((await app.inject({ url: `/api/v1/${url}` })).statusCode, url).toBe(401);
    }
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/users/me/profile', payload: {} })).statusCode).toBe(401);
  });
});

describe('people', () => {
  it('lists everyone, falling back to the username when there is no display name', async () => {
    const list = await people();
    expect(list.map((p) => p.username).sort()).toEqual(['admin', 'bob']);
    expect(list.find((p) => p.username === 'bob').displayName).toBe('bob');
    expect(list.find((p) => p.username === 'admin').isMe).toBe(true);
    expect(list.find((p) => p.username === 'bob').isMe).toBe(false);
  });

  it('shows a display name and bio once set', async () => {
    await patch('users/me/profile', { displayName: 'Bobby', bio: 'Jazz on Sundays' }, asBob());
    const bobby = (await people()).find((p) => p.username === 'bob');
    expect(bobby).toMatchObject({ displayName: 'Bobby', bio: 'Jazz on Sundays' });
  });

  it('is off when the admin turned social features off', async () => {
    getDb().prepare("INSERT INTO settings (key, value) VALUES ('social_enabled', 'false')").run();
    expect((await get('social/people')).statusCode).toBe(403);
    expect((await get(`social/people/${bob}`)).statusCode).toBe(403);
    expect((await get('social/status')).json()).toEqual({ enabled: false });
  });

  it('is on by default', async () => {
    expect((await get('social/status')).json()).toEqual({ enabled: true });
  });
});

describe('"now listening" is opt-in', () => {
  it('is hidden by default, even while someone is playing', async () => {
    play(bob, 20);
    expect((await people()).find((p) => p.username === 'bob').nowListening).toBeNull();
    expect(((await get(`social/people/${bob}`)).json() as Json).profile.nowListening).toBeNull();
  });

  it('shows what they are playing once they turn it on', async () => {
    play(bob, 20);
    await patch('users/me/profile', { showListening: true }, asBob());
    const now = (await people()).find((p) => p.username === 'bob').nowListening;
    expect(now.title).toBe('Test Track');
    expect(now.artist).toBe('Test Artist');
  });

  it('disappears when the song is over, or the play was long ago', async () => {
    await patch('users/me/profile', { showListening: true }, asBob());
    play(bob, 600); // a 210 s song started 10 minutes ago
    expect((await people()).find((p) => p.username === 'bob').nowListening).toBeNull();
  });

  it('turning it off hides it again at once', async () => {
    play(bob, 20);
    await patch('users/me/profile', { showListening: true }, asBob());
    await patch('users/me/profile', { showListening: false }, asBob());
    expect((await people()).find((p) => p.username === 'bob').nowListening).toBeNull();
  });

  it('you always see your own, whatever your setting', async () => {
    play(1, 20);
    expect((await people()).find((p) => p.isMe).nowListening?.title).toBe('Test Track');
  });
});

describe('playlists on a profile', () => {
  it('shows only public playlists of someone else, but all of your own', async () => {
    const db = getDb();
    db.prepare("INSERT INTO playlists (owner_id, name, is_public) VALUES (?, 'Open mix', 1)").run(bob);
    db.prepare("INSERT INTO playlists (owner_id, name, is_public) VALUES (?, 'Secret mix', 0)").run(bob);

    const theirs = ((await get(`social/people/${bob}`)).json() as Json).profile;
    expect(theirs.playlists.map((p: Json) => p.name)).toEqual(['Open mix']);
    expect(theirs.publicPlaylistCount).toBe(1);

    const mine = ((await get(`social/people/${bob}`, asBob())).json() as Json).profile;
    expect(mine.playlists.map((p: Json) => p.name).sort()).toEqual(['Open mix', 'Secret mix']);
  });

  it('404s for a person that does not exist, 400s for a bad id', async () => {
    expect((await get('social/people/999999')).statusCode).toBe(404);
    expect((await get('social/people/abc')).statusCode).toBe(400);
  });
});

describe('PATCH /users/me/profile', () => {
  it('cleans and caps the text, and clears a field with null or blank', async () => {
    await patch('users/me/profile', { displayName: `  A\u0007B‮${'x'.repeat(100)}  `, bio: 'b'.repeat(500) });
    let me = ((await get('users/me')).json() as Json).profile;
    expect(me.displayName).toBe(`AB${'x'.repeat(38)}`);
    expect(me.bio.length).toBe(200);

    await patch('users/me/profile', { displayName: null, bio: '   ' });
    me = ((await get('users/me')).json() as Json).profile;
    expect(me.displayName).toBeNull();
    expect(me.bio).toBeNull();
  });

  it('rejects the wrong types', async () => {
    expect((await patch('users/me/profile', { displayName: 42 })).statusCode).toBe(400);
    expect((await patch('users/me/profile', { showListening: 'yes' })).statusCode).toBe(400);
  });

  it('only ever changes the caller\'s own profile', async () => {
    await patch('users/me/profile', { displayName: 'Mine' });
    expect((await people(asBob())).find((p) => p.username === 'bob').displayName).toBe('bob');
  });
});

describe('cleanText', () => {
  it('drops control characters and direction overrides', () => {
    expect(cleanText('a\u0000b‏c⁧d', 50)).toBe('abcd');
    expect(cleanText('   ', 5)).toBeNull();
    expect(cleanText(7, 5)).toBeNull();
  });
});

describe('avatars', () => {
  const png = async (w: number, h: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();

  async function upload(qs: string, filename: string, mime: string, data: Buffer) {
    const { body, contentType } = multipart(filename, mime, data);
    return app.inject({ method: 'POST', url: `/api/v1/users/me/avatar?${qs}`, payload: body, headers: { 'content-type': contentType } });
  }

  it('turns any upload into a 256×256 JPEG and serves it', async () => {
    const res = await upload(admin, 'me.png', 'image/png', await png(800, 400));
    expect(res.statusCode).toBe(200);

    const img = await get('social/avatar/1');
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(img.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 256, 256]);

    const person = (await people()).find((p) => p.isMe);
    expect(person.hasAvatar).toBe(true);
    expect(person.avatarVersion).toBeGreaterThan(0);
  });

  it('strips metadata such as GPS from the stored picture', async () => {
    const withExif = await sharp(await png(300, 300)).withExif({ IFD0: { Copyright: 'secret-location' } }).jpeg().toBuffer();
    await upload(admin, 'me.jpg', 'image/jpeg', withExif);
    const stored = (await get('social/avatar/1')).rawPayload;
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes(Buffer.from('secret-location'))).toBe(false);
  });

  it('refuses things that are not images', async () => {
    expect((await upload(admin, 'x.txt', 'text/plain', Buffer.from('hi'))).statusCode).toBe(400);
    expect((await upload(admin, 'x.png', 'image/png', Buffer.from('definitely not a png'))).statusCode).toBe(400);
  });

  it('others can see it while social is on; when it is off only your own', async () => {
    await upload(asBob(), 'b.png', 'image/png', await png(100, 100));
    expect((await get(`social/avatar/${bob}`)).statusCode).toBe(200);

    getDb().prepare("INSERT INTO settings (key, value) VALUES ('social_enabled', 'false')").run();
    expect((await get(`social/avatar/${bob}`)).statusCode).toBe(403);
    expect((await get(`social/avatar/${bob}`, asBob())).statusCode).toBe(200);
  });

  it('can be removed, deleting the file', async () => {
    await upload(admin, 'me.png', 'image/png', await png(100, 100));
    const file = (getDb().prepare('SELECT avatar_path FROM users WHERE id = 1').get() as { avatar_path: string }).avatar_path;
    expect(existsSync(file)).toBe(true);

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/users/me/avatar?${admin}` })).statusCode).toBe(200);
    expect(existsSync(file)).toBe(false);
    expect((await get('social/avatar/1')).statusCode).toBe(404);
  });

  it('404s for someone without one, 400s for a bad id', async () => {
    expect((await get(`social/avatar/${bob}`)).statusCode).toBe(404);
    expect((await get('social/avatar/xyz')).statusCode).toBe(400);
  });
});

describe('GET /users/me', () => {
  it('includes the profile, with listening sharing off by default', async () => {
    const me = (await get('users/me')).json() as Json;
    expect(me.profile).toEqual({ displayName: null, bio: null, hasAvatar: false, avatarVersion: null, showListening: false });
  });
});
