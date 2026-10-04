import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'fs/promises';
import { writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { closeDb, getDb } from '../../db/database.js';
import { authParams } from './helpers.js';
import { getInFlightExtractionCount } from '../../routes/subsonic/endpoints/coverArt.js';

/**
 * Build a minimal ID3v2.3 binary containing a single APIC (attached picture)
 * frame. Music-metadata will parse this and return the picture with the given
 * MIME type string — exactly what the getCoverArt embedded-art path reads.
 */
function buildId3WithApic(mimeType: string, imageData: Buffer): Buffer {
  // APIC frame body
  const apicContent = Buffer.concat([
    Buffer.from([0x00]),                     // text encoding: ISO-8859-1
    Buffer.from(`${mimeType}\x00`, 'ascii'), // MIME type + null terminator
    Buffer.from([0x03]),                     // picture type: Cover (front)
    Buffer.from([0x00]),                     // description: empty + null
    imageData,
  ]);

  // APIC frame = 4-char ID + 4-byte size (plain big-endian in v2.3) + 2-byte flags + content
  const apicFrame = Buffer.allocUnsafe(10 + apicContent.length);
  apicFrame.write('APIC', 0, 'ascii');
  apicFrame.writeUInt32BE(apicContent.length, 4);
  apicFrame.writeUInt16BE(0x0000, 8);
  apicContent.copy(apicFrame, 10);

  // ID3v2.3 header: "ID3" + version(2.3.0) + flags + syncsafe tag-size
  const tagSize = apicFrame.length;
  const id3Header = Buffer.allocUnsafe(10);
  id3Header.write('ID3', 0, 'ascii');
  id3Header[3] = 0x03; id3Header[4] = 0x00; id3Header[5] = 0x00;
  id3Header[6] = (tagSize >> 21) & 0x7f;
  id3Header[7] = (tagSize >> 14) & 0x7f;
  id3Header[8] = (tagSize >> 7)  & 0x7f;
  id3Header[9] =  tagSize        & 0x7f;

  return Buffer.concat([id3Header, apicFrame]);
}

// Minimal 1×1 red PNG (valid file so createReadStream doesn't fail)
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
  '77533d0000000c4944415408d7636068f8cf0000000200019e221bc60000' +
  '00004945444ae426082',
  'hex',
);

// Minimal valid WAV (44-byte header, 0 data samples)
function writeWav(filePath: string): void {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36, 4);
  b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32);  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(0, 40);
  writeFileSync(filePath, b);
}

async function makePng(size: number): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .png()
    .toBuffer();
}

let app: FastifyInstance;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'riffplayer-covers-'));
  process.env.COVERS_DIR = path.join(tmpDir, 'cache');
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
});

afterEach(async () => {
  delete process.env.COVERS_DIR;
  await app.close();
  closeDb();
  await rm(tmpDir, { recursive: true });
});

const auth = authParams();

describe('getCoverArt.view — errors', () => {
  it('returns MISSING_PARAM when id is absent', async () => {
    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}` });
    const body = JSON.parse(res.body)['subsonic-response'] as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect((body.error as Record<string, unknown>).code).toBe(10);
  });

  it('returns DATA_NOT_FOUND for unknown album id', async () => {
    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-99999` });
    const body = JSON.parse(res.body)['subsonic-response'] as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect((body.error as Record<string, unknown>).code).toBe(70);
  });

  it('returns DATA_NOT_FOUND for unknown artist id', async () => {
    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=ar-99999` });
    const body = JSON.parse(res.body)['subsonic-response'] as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect((body.error as Record<string, unknown>).code).toBe(70);
  });
});

describe('getCoverArt.view — album cover_path', () => {
  it('serves the image from cover_path with correct MIME', async () => {
    const coverFile = path.join(tmpDir, 'cover.png');
    await writeFile(coverFile, TINY_PNG);

    const db = getDb();
    const artistId = Number(
      db.prepare("INSERT INTO artists (name) VALUES ('A')").run().lastInsertRowid,
    );
    const albumId = Number(
      db.prepare('INSERT INTO albums (name, artist_id, cover_path) VALUES (?, ?, ?)')
        .run('Album', artistId, coverFile).lastInsertRowid,
    );

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('serves album art via plain numeric id (al- prefix omitted)', async () => {
    const coverFile = path.join(tmpDir, 'cover.png');
    await writeFile(coverFile, TINY_PNG);

    const db = getDb();
    const artistId = Number(
      db.prepare("INSERT INTO artists (name) VALUES ('B')").run().lastInsertRowid,
    );
    const albumId = Number(
      db.prepare('INSERT INTO albums (name, artist_id, cover_path) VALUES (?, ?, ?)')
        .run('Album2', artistId, coverFile).lastInsertRowid,
    );

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=${albumId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });
});

describe('getCoverArt.view — embedded art extraction', () => {
  it('returns DATA_NOT_FOUND when WAV has no embedded art', async () => {
    const wavPath = path.join(tmpDir, 'bare.wav');
    writeWav(wavPath);

    const db = getDb();
    const artistId = Number(
      db.prepare("INSERT INTO artists (name) VALUES ('C')").run().lastInsertRowid,
    );
    const albumId = Number(
      db.prepare('INSERT INTO albums (name, artist_id) VALUES (?, ?)').run('Album3', artistId).lastInsertRowid,
    );
    db.prepare('INSERT INTO tracks (title, album_id, artist_id, path) VALUES (?, ?, ?, ?)')
      .run('Track', albumId, artistId, wavPath);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}` });
    const body = JSON.parse(res.body)['subsonic-response'] as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect((body.error as Record<string, unknown>).code).toBe(70);
  });

  it('returns DATA_NOT_FOUND when album has no tracks', async () => {
    const db = getDb();
    const artistId = Number(
      db.prepare("INSERT INTO artists (name) VALUES ('D')").run().lastInsertRowid,
    );
    const albumId = Number(
      db.prepare('INSERT INTO albums (name, artist_id) VALUES (?, ?)').run('Album4', artistId).lastInsertRowid,
    );

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}` });
    const body = JSON.parse(res.body)['subsonic-response'] as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect((body.error as Record<string, unknown>).code).toBe(70);
  });

  it('serves cached art on second request (covers dir populated)', async () => {
    const cacheDir = process.env.COVERS_DIR!;
    await mkdir(cacheDir, { recursive: true });
    const cachedCover = path.join(cacheDir, 'al-1.jpg');
    await writeFile(cachedCover, TINY_PNG);

    const db = getDb();
    const artistId = Number(
      db.prepare("INSERT INTO artists (name) VALUES ('E')").run().lastInsertRowid,
    );
    // albumId will be 1 since in-memory DB
    db.prepare('INSERT INTO albums (name, artist_id) VALUES (?, ?)').run('Album5', artistId);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-1` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });
});

describe('getCoverArt.view — embedded art MIME normalisation', () => {
  // Minimal valid JPEG: Start-of-Image + End-of-Image markers only
  const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  async function insertAlbumWithTrack(name: string, filePath: string): Promise<number> {
    const db = getDb();
    const artistId = Number(
      db.prepare('INSERT INTO artists (name) VALUES (?)').run(name).lastInsertRowid,
    );
    const albumId = Number(
      db.prepare('INSERT INTO albums (name, artist_id) VALUES (?, ?)').run(name, artistId).lastInsertRowid,
    );
    db.prepare('INSERT INTO tracks (title, album_id, artist_id, path) VALUES (?, ?, ?, ?)')
      .run('Track', albumId, artistId, filePath);
    return albumId;
  }

  it('serves embedded JPEG tagged as "image/jpg" (the primary bug)', async () => {
    const filePath = path.join(tmpDir, 'jpg-mime.mp3');
    writeFileSync(filePath, buildId3WithApic('image/jpg', tinyJpeg));
    const albumId = await insertAlbumWithTrack('MimeJpg', filePath);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('serves embedded art with uppercase MIME "IMAGE/JPEG"', async () => {
    const filePath = path.join(tmpDir, 'upper-jpeg.mp3');
    writeFileSync(filePath, buildId3WithApic('IMAGE/JPEG', tinyJpeg));
    const albumId = await insertAlbumWithTrack('UpperJpeg', filePath);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('serves embedded PNG tagged as uppercase "IMAGE/PNG"', async () => {
    const filePath = path.join(tmpDir, 'upper-png.mp3');
    writeFileSync(filePath, buildId3WithApic('IMAGE/PNG', TINY_PNG));
    const albumId = await insertAlbumWithTrack('UpperPng', filePath);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('serves embedded art with MIME params "image/jpeg; charset=utf-8"', async () => {
    const filePath = path.join(tmpDir, 'param-jpeg.mp3');
    writeFileSync(filePath, buildId3WithApic('image/jpeg; charset=utf-8', tinyJpeg));
    const albumId = await insertAlbumWithTrack('ParamJpeg', filePath);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('coalesces concurrent requests for the same uncached album into a single in-flight extraction', async () => {
    const filePath = path.join(tmpDir, 'coalesce.mp3');
    writeFileSync(filePath, buildId3WithApic('image/jpeg', tinyJpeg));
    const albumId = await insertAlbumWithTrack('Coalesce', filePath);

    const requests = Array.from({ length: 5 }, () =>
      app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}` }),
    );

    // Poll briefly for the extraction to actually start, then assert only
    // one is ever in flight despite 5 concurrent callers for the same album.
    let sawInFlight = false;
    for (let i = 0; i < 20; i++) {
      const n = getInFlightExtractionCount();
      if (n > 0) {
        sawInFlight = true;
        expect(n).toBe(1);
        break;
      }
      await new Promise((r) => setImmediate(r));
    }
    expect(sawInFlight).toBe(true);

    const results = await Promise.all(requests);
    for (const res of results) {
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(results[0].rawPayload)).toBe(true);
    }
    expect(getInFlightExtractionCount()).toBe(0);
  });
});

describe('getCoverArt.view — artist image', () => {
  it('serves artist image with correct MIME', async () => {
    const imgFile = path.join(tmpDir, 'artist.jpg');
    await writeFile(imgFile, TINY_PNG);

    const db = getDb();
    const artistId = Number(
      db.prepare('INSERT INTO artists (name, image_path) VALUES (?, ?)').run('Artist', imgFile).lastInsertRowid,
    );

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=ar-${artistId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('returns DATA_NOT_FOUND for artist with no image_path', async () => {
    const db = getDb();
    const artistId = Number(
      db.prepare("INSERT INTO artists (name) VALUES ('NoImg')").run().lastInsertRowid,
    );

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=ar-${artistId}` });
    const body = JSON.parse(res.body)['subsonic-response'] as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect((body.error as Record<string, unknown>).code).toBe(70);
  });
});

describe('getCoverArt.view — playlist cover', () => {
  it('serves an uploaded playlist cover with correct MIME', async () => {
    const create = await app.inject({ url: `/rest/createPlaylist.view?${auth}&name=CoverTest` });
    const plId = (JSON.parse(create.body)['subsonic-response'] as Record<string, Record<string, unknown>>)
      .playlist.id as string;

    const coverFile = path.join(tmpDir, 'playlist-cover.png');
    await writeFile(coverFile, TINY_PNG);
    getDb().prepare('UPDATE playlists SET cover_path = ? WHERE id = ?').run(coverFile, plId);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=pl-${plId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('returns DATA_NOT_FOUND when playlist has no cover uploaded', async () => {
    const create = await app.inject({ url: `/rest/createPlaylist.view?${auth}&name=NoCoverYet` });
    const plId = (JSON.parse(create.body)['subsonic-response'] as Record<string, Record<string, unknown>>)
      .playlist.id as string;

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=pl-${plId}` });
    const body = JSON.parse(res.body)['subsonic-response'] as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect((body.error as Record<string, unknown>).code).toBe(70);
  });

  it('returns DATA_NOT_FOUND for unknown playlist id', async () => {
    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=pl-99999` });
    const body = JSON.parse(res.body)['subsonic-response'] as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect((body.error as Record<string, unknown>).code).toBe(70);
  });
});

describe('getCoverArt.view — size param (#72)', () => {
  async function insertAlbumWithCover(name: string, coverPath: string): Promise<number> {
    const db = getDb();
    const artistId = Number(
      db.prepare('INSERT INTO artists (name) VALUES (?)').run(name).lastInsertRowid,
    );
    return Number(
      db.prepare('INSERT INTO albums (name, artist_id, cover_path) VALUES (?, ?, ?)')
        .run(name, artistId, coverPath).lastInsertRowid,
    );
  }

  it('downscales a manual album cover to fit within the requested size', async () => {
    const coverFile = path.join(tmpDir, 'big-cover.png');
    await writeFile(coverFile, await makePng(400));
    const albumId = await insertAlbumWithCover('SizeAlbum', coverFile);

    const full = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}` });
    expect((await sharp(full.rawPayload).metadata()).width).toBe(400);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}&size=100` });
    expect(res.statusCode).toBe(200);
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.width).toBeLessThanOrEqual(100);
    expect(meta.height).toBeLessThanOrEqual(100);
  });

  it('does not upscale an image smaller than the requested size', async () => {
    const coverFile = path.join(tmpDir, 'small-cover.png');
    await writeFile(coverFile, await makePng(50));
    const albumId = await insertAlbumWithCover('SmallSizeAlbum', coverFile);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}&size=300` });
    expect(res.statusCode).toBe(200);
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.width).toBe(50);
  });

  it('caches the resized output to disk, keyed by size, and reuses it on the next request', async () => {
    const coverFile = path.join(tmpDir, 'cache-cover.png');
    await writeFile(coverFile, await makePng(400));
    const albumId = await insertAlbumWithCover('CacheSizeAlbum', coverFile);
    const cacheDir = process.env.COVERS_DIR!;

    await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}&size=120` });
    const cachedFile = path.join(cacheDir, `al-${albumId}-manual-120.png`);
    const files = await readdir(cacheDir);
    expect(files).toContain(`al-${albumId}-manual-120.png`);

    // Second request should serve straight from the cached file — same bytes.
    const res2 = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}&size=120` });
    const cachedBytes = await sharp(cachedFile).toBuffer();
    expect(res2.rawPayload.equals(cachedBytes)).toBe(true);
  });

  it('ignores a non-numeric size and serves the full image', async () => {
    const coverFile = path.join(tmpDir, 'garbage-size.png');
    await writeFile(coverFile, await makePng(200));
    const albumId = await insertAlbumWithCover('GarbageSizeAlbum', coverFile);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}&size=notanumber` });
    expect(res.statusCode).toBe(200);
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.width).toBe(200);
  });

  it('clamps an excessively large size instead of serving/caching it unbounded', async () => {
    const coverFile = path.join(tmpDir, 'clamp-size.png');
    await writeFile(coverFile, await makePng(300));
    const albumId = await insertAlbumWithCover('ClampSizeAlbum', coverFile);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}&size=999999` });
    expect(res.statusCode).toBe(200);
    const meta = await sharp(res.rawPayload).metadata();
    // Source is only 300px, so a clamped max size still can't upscale it —
    // this mainly proves the request doesn't error or hang on a huge value.
    expect(meta.width).toBe(300);
  });

  it('resizes embedded (non-manual) album art and keeps a separate cache namespace from manual covers', async () => {
    const filePath = path.join(tmpDir, 'embedded-size.mp3');
    const jpeg = await sharp({
      create: { width: 250, height: 250, channels: 3, background: { r: 10, g: 200, b: 10 } },
    })
      .jpeg()
      .toBuffer();
    writeFileSync(filePath, buildId3WithApic('image/jpeg', jpeg));

    const db = getDb();
    const artistId = Number(
      db.prepare("INSERT INTO artists (name) VALUES ('EmbeddedSize')").run().lastInsertRowid,
    );
    const albumId = Number(
      db.prepare('INSERT INTO albums (name, artist_id) VALUES (?, ?)')
        .run('EmbeddedSize', artistId).lastInsertRowid,
    );
    db.prepare('INSERT INTO tracks (title, album_id, artist_id, path) VALUES (?, ?, ?, ?)')
      .run('Track', albumId, artistId, filePath);

    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=al-${albumId}&size=80` });
    expect(res.statusCode).toBe(200);
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.width).toBeLessThanOrEqual(80);

    const files = await readdir(process.env.COVERS_DIR!);
    expect(files).toContain(`al-${albumId}-80.jpg`);
    expect(files).not.toContain(`al-${albumId}-manual-80.jpg`);
  });

  it('serves artist and playlist images resized too, in their own cache namespaces', async () => {
    const artistImg = path.join(tmpDir, 'artist-size.png');
    await writeFile(artistImg, await makePng(300));
    const db = getDb();
    const artistId = Number(
      db.prepare('INSERT INTO artists (name, image_path) VALUES (?, ?)')
        .run('SizeArtist', artistImg).lastInsertRowid,
    );

    const artistRes = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=ar-${artistId}&size=64` });
    expect(artistRes.statusCode).toBe(200);
    expect((await sharp(artistRes.rawPayload).metadata()).width).toBeLessThanOrEqual(64);

    const create = await app.inject({ url: `/rest/createPlaylist.view?${auth}&name=SizePlaylist` });
    const plId = (JSON.parse(create.body)['subsonic-response'] as Record<string, Record<string, unknown>>)
      .playlist.id as string;
    const plCover = path.join(tmpDir, 'playlist-size.png');
    await writeFile(plCover, await makePng(300));
    db.prepare('UPDATE playlists SET cover_path = ? WHERE id = ?').run(plCover, plId);

    const plRes = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=pl-${plId}&size=64` });
    expect(plRes.statusCode).toBe(200);
    expect((await sharp(plRes.rawPayload).metadata()).width).toBeLessThanOrEqual(64);

    const files = await readdir(process.env.COVERS_DIR!);
    expect(files).toContain(`ar-${artistId}-64.png`);
    expect(files).toContain(`pl-${plId}-64.png`);
  });
});

describe('playlist mosaic cover', () => {
  const COLORS = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 255, g: 255, b: 0 },
  ];

  /** Seeds one album+track per entry; `color` null = an album with no cover art at all. */
  async function seedPlaylist(colors: ({ r: number; g: number; b: number } | null)[]): Promise<string> {
    const db = getDb();
    const artistId = Number(db.prepare("INSERT INTO artists (name) VALUES ('A')").run().lastInsertRowid);
    const trackIds: number[] = [];
    for (const [i, color] of colors.entries()) {
      let coverPath: string | null = null;
      if (color) {
        coverPath = path.join(tmpDir, `c${i}.png`);
        await writeFile(
          coverPath,
          await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer(),
        );
      }
      const albumId = Number(
        db.prepare('INSERT INTO albums (name, artist_id, cover_path) VALUES (?, ?, ?)')
          .run(`Album ${i}`, artistId, coverPath).lastInsertRowid,
      );
      trackIds.push(
        Number(
          db.prepare(`INSERT INTO tracks (title, album_id, artist_id, track_no, duration_s, path, size, format, bitrate)
                      VALUES (?, ?, ?, 1, 100, ?, 1, 'MPEG', 128)`)
            .run(`T${i}`, albumId, artistId, `/music/mosaic-${i}.mp3`).lastInsertRowid,
        ),
      );
    }
    const songs = trackIds.map((t) => `&songId=${t}`).join('');
    const create = await app.inject({ url: `/rest/createPlaylist.view?${auth}&name=Mix${songs}` });
    return (JSON.parse(create.body)['subsonic-response'] as Record<string, Record<string, unknown>>)
      .playlist.id as string;
  }

  async function coverIdOf(plId: string): Promise<string | undefined> {
    const res = await app.inject({ url: `/rest/getPlaylist.view?${auth}&id=${plId}` });
    return (JSON.parse(res.body)['subsonic-response'] as Record<string, Record<string, unknown>>)
      .playlist.coverArt as string | undefined;
  }

  async function pixel(buf: Buffer, x: number, y: number): Promise<number[]> {
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  }

  it('advertises a mosaic id for a playlist with songs but no uploaded cover, none when empty', async () => {
    const plId = await seedPlaylist([COLORS[0]]);
    expect(await coverIdOf(plId)).toMatch(new RegExp(`^plm-${plId}-`));

    const empty = await app.inject({ url: `/rest/createPlaylist.view?${auth}&name=Empty` });
    const emptyId = (JSON.parse(empty.body)['subsonic-response'] as Record<string, Record<string, unknown>>)
      .playlist.id as string;
    expect(await coverIdOf(emptyId)).toBeUndefined();
  });

  it('draws the first four distinct album covers as a 2x2 grid', async () => {
    const plId = await seedPlaylist([...COLORS, { r: 255, g: 255, b: 255 }]);
    const coverId = await coverIdOf(plId);
    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=${coverId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);

    const [tl, tr, bl, br] = await Promise.all([
      pixel(res.rawPayload, 150, 150), pixel(res.rawPayload, 450, 150),
      pixel(res.rawPayload, 150, 450), pixel(res.rawPayload, 450, 450),
    ]);
    expect(tl[0]).toBeGreaterThan(200); expect(tl[1]).toBeLessThan(60);   // red
    expect(tr[1]).toBeGreaterThan(200); expect(tr[0]).toBeLessThan(60);   // green
    expect(bl[2]).toBeGreaterThan(200); expect(bl[0]).toBeLessThan(60);   // blue
    expect(br[0]).toBeGreaterThan(200); expect(br[1]).toBeGreaterThan(200); // yellow
  });

  it('skips albums without art when picking the four', async () => {
    const plId = await seedPlaylist([null, ...COLORS]);
    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=${await coverIdOf(plId)}` });
    const tl = await pixel(res.rawPayload, 150, 150);
    expect(tl[0]).toBeGreaterThan(200); // first tile is the first album that HAS art (red)
  });

  it('falls back to a single cover when fewer than four albums have art', async () => {
    const plId = await seedPlaylist([COLORS[2], COLORS[1]]);
    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=${await coverIdOf(plId)}` });
    expect(res.statusCode).toBe(200);
    const px = await pixel(res.rawPayload, 20, 20);
    expect(px[2]).toBeGreaterThan(200); // the first album's blue, not a grid
  });

  it('is DATA_NOT_FOUND when none of the tracks has art', async () => {
    const plId = await seedPlaylist([null]);
    const res = await app.inject({ url: `/rest/getCoverArt.view?${auth}&id=plm-${plId}-x` });
    const body = JSON.parse(res.body)['subsonic-response'] as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe(70);
  });

  it('lets an uploaded cover win over the mosaic', async () => {
    const plId = await seedPlaylist(COLORS);
    getDb().prepare('UPDATE playlists SET cover_path = ? WHERE id = ?').run(path.join(tmpDir, 'c0.png'), plId);
    expect(await coverIdOf(plId)).toBe(`pl-${plId}`);
  });

  it('changes the cover id when the playlist\'s tracks change', async () => {
    const plId = await seedPlaylist([COLORS[0], COLORS[1]]);
    const before = await coverIdOf(plId);
    getDb().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = 0').run(Number(plId));
    const after = await coverIdOf(plId);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });
});
