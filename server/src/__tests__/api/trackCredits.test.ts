import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { seedLibrary, authParams } from '../subsonic/helpers.js';

/** A minimal ID3v2.3 tag: one text frame per [id, text] pair (ISO-8859-1). */
function id3(frames: [string, string][]): Buffer {
  const body = Buffer.concat(
    frames.map(([id, text]) => {
      const content = Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'latin1')]);
      const head = Buffer.alloc(10);
      head.write(id, 0, 'ascii');
      head.writeUInt32BE(content.length, 4);
      return Buffer.concat([head, content]);
    }),
  );
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'ascii');
  header[3] = 3;
  header[6] = (body.length >> 21) & 0x7f;
  header[7] = (body.length >> 14) & 0x7f;
  header[8] = (body.length >> 7) & 0x7f;
  header[9] = body.length & 0x7f;
  return Buffer.concat([header, body]);
}

let app: FastifyInstance;
let tmpDir: string;
let ids: ReturnType<typeof seedLibrary>;
const auth = authParams();

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'riffplayer-credits-'));
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
  ids = seedLibrary(getDb());
});

afterEach(async () => {
  await app.close();
  closeDb();
  await rm(tmpDir, { recursive: true });
});

async function pointTrackAt(frames: [string, string][]): Promise<void> {
  const file = path.join(tmpDir, 'song.mp3');
  await writeFile(file, id3(frames));
  getDb().prepare('UPDATE tracks SET path = ? WHERE id = ?').run(file, ids.trackId);
}

const credits = (id: number | string) => app.inject({ url: `/api/v1/tracks/${id}/credits?${auth}` });

describe('GET /api/v1/tracks/:id/credits', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ url: `/api/v1/tracks/${ids.trackId}/credits` });
    expect(res.statusCode).toBe(401);
  });

  it('reads composer, lyricist, label, ISRC and copyright from the file\'s own tags', async () => {
    await pointTrackAt([
      ['TIT2', 'A Song'], ['TCOM', 'Jane Composer'], ['TEXT', 'Joe Lyricist'],
      ['TPUB', 'Some Label'], ['TSRC', 'GBAYE0000001'], ['TCOP', '2020 Some Label'],
    ]);
    const res = await credits(ids.trackId);
    expect(res.statusCode).toBe(200);
    expect(res.json().credits).toMatchObject({
      composers: ['Jane Composer'],
      lyricists: ['Joe Lyricist'],
      labels: ['Some Label'],
      isrc: ['GBAYE0000001'],
      copyright: '2020 Some Label',
    });
  });

  it('leaves out everything the file does not say', async () => {
    await pointTrackAt([['TIT2', 'Bare']]);
    const body = (await credits(ids.trackId)).json() as { credits: Record<string, unknown> };
    expect(body.credits).not.toHaveProperty('composers');
    expect(body.credits).not.toHaveProperty('isrc');
  });

  it('strips control characters from tag text', async () => {
    await pointTrackAt([['TCOM', 'Evil\u0007Name\u001b[31m']]);
    const { credits: c } = (await credits(ids.trackId)).json() as { credits: { composers: string[] } };
    expect(c.composers[0]).not.toMatch(/[\u0000-\u001f]/);
    expect(c.composers[0]).toContain('Evil Name');
  });

  it('404s for an unknown track, 400s for a bad id, 404s when the file is gone', async () => {
    expect((await credits(999999)).statusCode).toBe(404);
    expect((await credits('abc')).statusCode).toBe(400);
    // seedLibrary's track points at /music/test.mp3, which doesn't exist
    const res = await credits(ids.trackId);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'The file could not be read' });
  });
});
