import { createReadStream } from 'fs';
import { mkdir, writeFile, access } from 'fs/promises';
import path from 'path';
import { parseFile } from 'music-metadata';
import sharp from 'sharp';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../../db/database.js';
import { sendError, SubsonicErrorCode } from '../response.js';
import { isSettingEnabled, COVER_LOOKUP_SETTING } from '../../../settings.js';

// Subsonic clients pass arbitrary size= values (thumbnail grids commonly ask
// for 64-300px); without an upper bound a malicious or buggy client could
// force repeated full-resolution sharp() decodes by requesting a new huge
// size on every call. Real UIs never need more than this.
const MAX_COVER_SIZE = 1500;

type Q = Record<string, string | undefined>;
const p = (req: FastifyRequest) => ({ ...(req.query as Q), ...((req.body as Q) ?? {}) });

function getCoversDir(): string {
  return process.env.COVERS_DIR ?? path.join(process.cwd(), 'covers');
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Normalise a raw MIME type string from an ID3/Vorbis tag before looking it up
 * in MIME_TO_EXT. Real-world files contain many variants:
 *   • 'image/jpg'  — technically invalid but produced by many taggers
 *   • 'IMAGE/JPEG' — uppercase from some Windows tools
 *   • 'image/jpeg; charset=utf-8' — params from some encoders
 *   • 'jpg'/'png'  — bare extension strings from ID3v2.2-era PIC frames
 */
function normalizeMime(raw: string): string {
  const s = raw.toLowerCase().split(';')[0].trim();
  if (s === 'image/jpg') return 'image/jpeg';
  if (s === 'jpg' || s === 'jpeg') return 'image/jpeg';
  if (s === 'png') return 'image/png';
  if (s === 'gif') return 'image/gif';
  if (s === 'webp') return 'image/webp';
  return s;
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseSize(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, MAX_COVER_SIZE);
}

// Coalesces concurrent resize requests for the same cache file, mirroring
// inFlightExtractions above — a grid of albums/artists first loading at a
// given thumbnail size would otherwise fire several redundant sharp() runs
// for the same output file.
const inFlightResizes = new Map<string, Promise<void>>();

/**
 * Resize `sourcePath` to fit within size×size, caching the result on disk
 * next to the existing per-album cover cache so repeat requests at the same
 * size are a disk read, not a re-encode. Falls back to serving the original
 * file untouched if sharp can't process it (e.g. an unexpected format) —
 * a stale/no thumbnail is never worse than a 500.
 */
async function resizeAndCache(
  sourcePath: string,
  sourceMime: string,
  size: number,
  coversDir: string,
  cacheKeyPrefix: string,
): Promise<{ filePath: string; mime: string }> {
  const ext = MIME_TO_EXT[sourceMime] ?? path.extname(sourcePath).slice(1).toLowerCase() ?? 'jpg';
  const cachePath = path.join(coversDir, `${cacheKeyPrefix}-${size}.${ext}`);

  if (await fileExists(cachePath)) {
    return { filePath: cachePath, mime: sourceMime };
  }

  try {
    let inFlight = inFlightResizes.get(cachePath);
    if (!inFlight) {
      inFlight = (async () => {
        await mkdir(coversDir, { recursive: true });
        await sharp(sourcePath)
          .resize(size, size, { fit: 'inside', withoutEnlargement: true })
          .toFile(cachePath);
      })().finally(() => {
        inFlightResizes.delete(cachePath);
      });
      inFlightResizes.set(cachePath, inFlight);
    }
    await inFlight;
    return { filePath: cachePath, mime: sourceMime };
  } catch {
    return { filePath: sourcePath, mime: sourceMime };
  }
}

async function respondWithImage(
  reply: FastifyReply,
  filePath: string,
  mime: string,
  size: number | undefined,
  coversDir: string,
  cacheKeyPrefix: string,
): Promise<FastifyReply> {
  if (!size) {
    reply.header('Content-Type', mime);
    return reply.send(createReadStream(filePath));
  }
  const resized = await resizeAndCache(filePath, mime, size, coversDir, cacheKeyPrefix);
  reply.header('Content-Type', resized.mime);
  return reply.send(createReadStream(resized.filePath));
}

async function findCachedAlbumArt(
  albumId: number,
  coversDir: string,
): Promise<{ filePath: string; mime: string } | null> {
  for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
    const candidate = path.join(coversDir, `al-${albumId}.${ext}`);
    if (await fileExists(candidate)) return { filePath: candidate, mime };
  }
  return null;
}

async function fetchFromCoverArtArchive(
  albumId: number,
  coversDir: string,
): Promise<{ filePath: string; mime: string } | null> {
  const album = getDb()
    .prepare('SELECT mbid FROM albums WHERE id = ?')
    .get(albumId) as { mbid: string | null } | undefined;
  if (!album?.mbid) return null;
  // Sends the album's MusicBrainz ID to an outside service — admin can switch off.
  if (!isSettingEnabled(COVER_LOOKUP_SETTING)) return null;

  // CAA returns a redirect to the actual image; follow it
  const url = `https://coverartarchive.org/release/${album.mbid}/front-500`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    const ext = MIME_TO_EXT[contentType] ?? 'jpg';
    const mime = contentType || 'image/jpeg';

    await mkdir(coversDir, { recursive: true });
    const cachePath = path.join(coversDir, `al-${albumId}.${ext}`);
    await writeFile(cachePath, Buffer.from(await res.arrayBuffer()));
    return { filePath: cachePath, mime };
  } catch {
    return null;
  }
}

// Coalesces concurrent requests for the same not-yet-cached album's cover
// art. Without this, several simultaneous requests for the same album (e.g.
// a grid view loading many albums at once, or a freshly emptied cache) would
// each independently re-parse the track file or re-fetch from Cover Art
// Archive and race to write the same cache file — not corruption, but
// wasted CPU and network. Checked-and-set synchronously (no `await` in
// between), so it's safe even for requests handled back to back.
const inFlightExtractions = new Map<number, Promise<{ filePath: string; mime: string } | null>>();

/** Primarily for tests — the number of album covers currently being
 * extracted, to verify concurrent requests for the same album coalesce into
 * a single in-flight entry rather than each starting their own. */
export function getInFlightExtractionCount(): number {
  return inFlightExtractions.size;
}

async function extractAndCacheAlbumArt(
  albumId: number,
  coversDir: string,
): Promise<{ filePath: string; mime: string } | null> {
  const inFlight = inFlightExtractions.get(albumId);
  if (inFlight) return inFlight;

  const promise = doExtractAndCacheAlbumArt(albumId, coversDir).finally(() => {
    inFlightExtractions.delete(albumId);
  });
  inFlightExtractions.set(albumId, promise);
  return promise;
}

async function doExtractAndCacheAlbumArt(
  albumId: number,
  coversDir: string,
): Promise<{ filePath: string; mime: string } | null> {
  const cached = await findCachedAlbumArt(albumId, coversDir);
  if (cached) return cached;

  // 1. Try embedded art in the first track
  const track = getDb()
    .prepare('SELECT path FROM tracks WHERE album_id = ? LIMIT 1')
    .get(albumId) as { path: string } | undefined;
  if (track) {
    try {
      const metadata = await parseFile(track.path, { skipCovers: false });
      const picture = metadata.common.picture?.[0];
      if (picture) {
        const mime = normalizeMime(picture.format);
        const ext = MIME_TO_EXT[mime];
        if (ext) {
          await mkdir(coversDir, { recursive: true });
          const cachePath = path.join(coversDir, `al-${albumId}.${ext}`);
          await writeFile(cachePath, picture.data);
          return { filePath: cachePath, mime };
        }
      }
    } catch {
      // fall through to Cover Art Archive
    }
  }

  // 2. Fetch from Cover Art Archive using album MBID
  return fetchFromCoverArtArchive(albumId, coversDir);
}

/**
 * The image to use for an album: a manually uploaded cover first, else art
 * embedded in its first track / fetched from Cover Art Archive (cached on disk).
 * `cacheKey` is the prefix for resized copies.
 */
async function resolveAlbumArt(
  albumId: number,
  coversDir: string,
): Promise<{ filePath: string; mime: string; cacheKey: string } | null> {
  const album = getDb()
    .prepare('SELECT cover_path FROM albums WHERE id = ?')
    .get(albumId) as { cover_path: string | null } | undefined;
  if (!album) return null;

  if (album.cover_path) {
    // Separate cache-key namespace from the embedded/CAA path below so a
    // manually-uploaded cover that's later removed can't serve a stale
    // resized thumbnail cached under the same album id.
    return {
      filePath: album.cover_path,
      mime: mimeFromPath(album.cover_path),
      cacheKey: `al-${albumId}-manual`,
    };
  }

  const art = await extractAndCacheAlbumArt(albumId, coversDir);
  return art ? { ...art, cacheKey: `al-${albumId}` } : null;
}

const MOSAIC_SIZE = 600;
// How many of a playlist's albums to try (in track order) while hunting for
// four that actually have art — bounds the work for a playlist of coverless albums.
const MOSAIC_MAX_ALBUMS_TRIED = 24;

const inFlightMosaics = new Map<string, Promise<void>>();

/**
 * Cover for a playlist with no uploaded one: a 2x2 grid of the covers of the
 * first four distinct albums (in playlist order) that have art. Fewer than
 * four such albums → just the first one's cover, as a lone tile in a grid
 * would look broken. Returns null when no track has any art.
 */
async function resolvePlaylistMosaic(
  playlistId: number,
  coversDir: string,
): Promise<{ filePath: string; mime: string; cacheKey: string } | null> {
  const rows = getDb()
    .prepare(
      `SELECT t.album_id AS albumId FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ? ORDER BY pt.position`,
    )
    .all(playlistId) as { albumId: number }[];
  const albumIds = [...new Set(rows.map((r) => r.albumId))].slice(0, MOSAIC_MAX_ALBUMS_TRIED);

  const arts: { albumId: number; filePath: string; mime: string; cacheKey: string }[] = [];
  for (const albumId of albumIds) {
    const art = await resolveAlbumArt(albumId, coversDir);
    if (art) arts.push({ albumId, ...art });
    if (arts.length === 4) break;
  }
  if (arts.length === 0) return null;
  if (arts.length < 4) return arts[0];

  const key = `plm-${playlistId}-${arts.map((a) => a.albumId).join('.')}`;
  const filePath = path.join(coversDir, `${key}.jpg`);
  if (!(await fileExists(filePath))) {
    let inFlight = inFlightMosaics.get(filePath);
    if (!inFlight) {
      inFlight = (async () => {
        await mkdir(coversDir, { recursive: true });
        const half = MOSAIC_SIZE / 2;
        const tiles = await Promise.all(
          arts.map((a) => sharp(a.filePath).resize(half, half, { fit: 'cover' }).jpeg().toBuffer()),
        );
        await sharp({
          create: { width: MOSAIC_SIZE, height: MOSAIC_SIZE, channels: 3, background: '#18181b' },
        })
          .composite(tiles.map((input, i) => ({ input, left: (i % 2) * half, top: Math.floor(i / 2) * half })))
          .jpeg({ quality: 85 })
          .toFile(filePath);
      })().finally(() => {
        inFlightMosaics.delete(filePath);
      });
      inFlightMosaics.set(filePath, inFlight);
    }
    try {
      await inFlight;
    } catch {
      return arts[0]; // sharp couldn't read one of the images — a single cover beats an error
    }
  }
  return { filePath, mime: 'image/jpeg', cacheKey: key };
}

async function coverArtHandler(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const { id, f, size: sizeRaw } = p(req);
  if (!id)
    return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'id required' });

  const size = parseSize(sizeRaw);
  const coversDir = getCoversDir();
  const db = getDb();

  // System-view covers ('sv-<key>') are keyed by the authenticated user, not
  // a numeric row id — every user has their own optional override per view.
  if (id.startsWith('sv-')) {
    const viewKey = id.slice(3);
    const userId = req.subsonicUser?.id;
    const row = userId
      ? (db
          .prepare('SELECT cover_path FROM system_view_settings WHERE user_id = ? AND view_key = ?')
          .get(userId, viewKey) as { cover_path: string | null } | undefined)
      : undefined;
    if (!row || !row.cover_path) {
      return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'No cover art' });
    }
    return respondWithImage(
      reply,
      row.cover_path,
      mimeFromPath(row.cover_path),
      size,
      coversDir,
      `sv-${userId}-${viewKey}`,
    );
  }

  let itemType: 'album' | 'artist' | 'playlist';
  let itemId: number;

  // Generated playlist mosaic: 'plm-<playlistId>-<sig>' (the sig only
  // versions the id for clients; the image is rebuilt from the live tracks).
  if (id.startsWith('plm-')) {
    const playlistId = Number(id.slice(4).split('-')[0]);
    if (!Number.isInteger(playlistId) || playlistId <= 0) {
      return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Invalid id' });
    }
    const art = await resolvePlaylistMosaic(playlistId, coversDir);
    if (!art) {
      return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'No cover art' });
    }
    return respondWithImage(reply, art.filePath, art.mime, size, coversDir, art.cacheKey);
  }

  if (id.startsWith('al-')) {
    itemType = 'album';
    itemId = Number(id.slice(3));
  } else if (id.startsWith('ar-')) {
    itemType = 'artist';
    itemId = Number(id.slice(3));
  } else if (id.startsWith('pl-')) {
    itemType = 'playlist';
    itemId = Number(id.slice(3));
  } else {
    itemType = 'album';
    itemId = Number(id);
  }

  if (!Number.isFinite(itemId) || itemId <= 0) {
    return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Invalid id' });
  }

  if (itemType === 'artist') {
    const artist = db
      .prepare('SELECT image_path FROM artists WHERE id = ?')
      .get(itemId) as { image_path: string | null } | undefined;
    if (!artist || !artist.image_path) {
      return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'No cover art' });
    }
    return respondWithImage(
      reply,
      artist.image_path,
      mimeFromPath(artist.image_path),
      size,
      coversDir,
      `ar-${itemId}`,
    );
  }

  if (itemType === 'playlist') {
    const playlist = db
      .prepare('SELECT cover_path FROM playlists WHERE id = ?')
      .get(itemId) as { cover_path: string | null } | undefined;
    if (!playlist || !playlist.cover_path) {
      return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'No cover art' });
    }
    return respondWithImage(
      reply,
      playlist.cover_path,
      mimeFromPath(playlist.cover_path),
      size,
      coversDir,
      `pl-${itemId}`,
    );
  }

  // Album: check manual cover_path first
  const album = db
    .prepare('SELECT id FROM albums WHERE id = ?')
    .get(itemId) as { id: number } | undefined;
  if (!album) {
    return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Album not found' });
  }

  const art = await resolveAlbumArt(itemId, coversDir);
  if (!art) {
    return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'No cover art found' });
  }

  return respondWithImage(reply, art.filePath, art.mime, size, coversDir, art.cacheKey);
}

export async function coverArtPlugin(app: FastifyInstance): Promise<void> {
  app.route({ method: ['GET', 'POST'], url: '/getCoverArt.view', handler: coverArtHandler });
}

/** The image file to use as an album's cover (uploaded, embedded or fetched), or null if it has none. */
export async function albumCoverFile(albumId: number): Promise<string | null> {
  return (await resolveAlbumArt(albumId, getCoversDir()))?.filePath ?? null;
}

/** A playlist's cover file: the uploaded one, else the generated mosaic, else null. */
export async function playlistCoverFile(playlistId: number): Promise<string | null> {
  const row = getDb().prepare('SELECT cover_path FROM playlists WHERE id = ?').get(playlistId) as
    | { cover_path: string | null }
    | undefined;
  if (row?.cover_path) return row.cover_path;
  return (await resolvePlaylistMosaic(playlistId, getCoversDir()))?.filePath ?? null;
}
