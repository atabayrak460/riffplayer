import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/database.js';
import { albumCoverFile, playlistCoverFile } from '../subsonic/endpoints/coverArt.js';
import {
  playlistCapacity,
  playlistPageCount,
  renderPlaylistPage,
  renderSongCard,
  type CardSize,
  type PlaylistCardInput,
} from '../../share/render.js';
import { jsonError } from './helpers.js';

// Share images are rendered here so every client (web, Android) gets the same picture and needs no
// layout code of its own. Rendering is CPU-heavy, so: at most two at a time, a short in-memory cache
// of finished pictures, and a per-route rate limit.

const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const CACHE_ENTRIES = 24;
const cache = new Map<string, Buffer>();

async function cached(key: string, render: () => Promise<Buffer>): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recently used goes last
    return hit;
  }
  const png = await withSlot(render);
  cache.set(key, png);
  if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  return png;
}

const hash = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex');

/** Changes when the cover file is replaced, so a cached picture never shows an old cover. */
async function fileStamp(file: string | null): Promise<string> {
  if (!file) return 'none';
  try {
    const s = await stat(file);
    return `${s.size}-${Math.round(s.mtimeMs)}`;
  } catch {
    return 'gone';
  }
}

const rateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

function sendPng(reply: FastifyReply, png: Buffer): void {
  reply
    .header('Content-Type', 'image/png')
    .header('Cache-Control', 'private, max-age=60')
    .send(png);
}

interface PlaylistRow {
  id: number;
  name: string;
  description: string | null;
  owner: string;
  songCount: number;
}

/** Everything a playlist share needs, or null if the playlist is missing / not visible to this user. */
async function loadPlaylist(id: number, userId: number): Promise<PlaylistCardInput | null> {
  const db = getDb();
  const playlist = db
    .prepare(
      `SELECT p.id, p.name, p.description, u.username AS owner,
              (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) AS songCount
       FROM playlists p JOIN users u ON u.id = p.owner_id
       WHERE p.id = ? AND (p.owner_id = ? OR p.is_public = 1)`,
    )
    .get(id, userId) as PlaylistRow | undefined;
  if (!playlist) return null;

  const rows = db
    .prepare(
      `SELECT t.title, ar.name AS artist, t.album_id AS albumId
       FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       JOIN artists ar ON ar.id = t.artist_id
       WHERE pt.playlist_id = ? ORDER BY pt.position LIMIT ?`,
    )
    .all(id, playlistCapacity()) as { title: string; artist: string; albumId: number }[];

  const covers = new Map<number, string | null>();
  for (const albumId of new Set(rows.map((r) => r.albumId))) {
    covers.set(albumId, await albumCoverFile(albumId).catch(() => null));
  }

  return {
    name: playlist.name,
    description: playlist.description,
    owner: playlist.owner,
    songCount: playlist.songCount,
    coverPath: await playlistCoverFile(id).catch(() => null),
    items: rows.map((r) => ({ title: r.title, artist: r.artist, coverPath: covers.get(r.albumId) ?? null })),
  };
}

export async function sharePlugin(app: FastifyInstance): Promise<void> {
  // GET /api/v1/share/song/:id?size=story|post — a picture of one song, ready to share
  app.get('/song/:id', { config: rateLimit }, async (req: FastifyRequest, reply: FastifyReply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return jsonError(reply, 400, 'Invalid song id');
    const sizeParam = (req.query as { size?: string }).size;
    const size: CardSize = sizeParam === 'post' ? 'post' : 'story';

    const song = getDb()
      .prepare(
        `SELECT t.title, ar.name AS artist, al.name AS album, t.album_id AS albumId
         FROM tracks t JOIN artists ar ON ar.id = t.artist_id JOIN albums al ON al.id = t.album_id
         WHERE t.id = ?`,
      )
      .get(id) as { title: string; artist: string; album: string; albumId: number } | undefined;
    if (!song) return jsonError(reply, 404, 'Song not found');

    // The scanner names an untagged album "Unknown Album" — that isn't worth printing on a card.
    const album = song.album && song.album !== 'Unknown Album' ? song.album : null;
    const coverPath = await albumCoverFile(song.albumId).catch(() => null);
    const key = `song:${size}:${hash([song.title, song.artist, album, await fileStamp(coverPath)])}`;
    const png = await cached(key, () => renderSongCard({ title: song.title, artist: song.artist, album, coverPath, size }));
    sendPng(reply, png);
  });

  // GET /api/v1/share/playlist/:id/pages — how many pictures this playlist needs
  app.get('/playlist/:id/pages', { config: rateLimit }, async (req: FastifyRequest, reply: FastifyReply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return jsonError(reply, 400, 'Invalid playlist id');
    const playlist = await loadPlaylist(id, req.subsonicUser!.id);
    if (!playlist) return jsonError(reply, 404, 'Playlist not found');
    reply.send({ pages: playlistPageCount(playlist.items.length), songs: playlist.songCount });
  });

  // GET /api/v1/share/playlist/:id/page/:n — picture n (1-based) of the playlist
  app.get('/playlist/:id/page/:n', { config: rateLimit }, async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string; n: string };
    const id = Number(params.id);
    const n = Number(params.n);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n < 1) return jsonError(reply, 400, 'Invalid request');
    const playlist = await loadPlaylist(id, req.subsonicUser!.id);
    if (!playlist) return jsonError(reply, 404, 'Playlist not found');
    const pages = playlistPageCount(playlist.items.length);
    if (n > pages) return jsonError(reply, 404, 'No such page');

    const stamp = await fileStamp(playlist.coverPath);
    const covers = await Promise.all(playlist.items.map((i) => fileStamp(i.coverPath)));
    const key = `playlist:${n}:${hash([playlist.name, playlist.description, playlist.owner, playlist.songCount, stamp, playlist.items.map((i, k) => [i.title, i.artist, covers[k]])])}`;
    const png = await cached(key, () => renderPlaylistPage(playlist, n - 1));
    sendPng(reply, png);
  });
}
