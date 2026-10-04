import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../../db/database.js';
import { sendOk, sendError, SubsonicErrorCode } from '../response.js';
import { xmlTag, artistAttrs, albumAttrs, songAttrs, toJson, type ArtistRow, type AlbumRow, type SongRow } from '../serialize.js';

type Q = Record<string, string | string[] | undefined>;
const p = (req: FastifyRequest) => ({ ...(req.query as Q), ...((req.body as Q) ?? {}) });
// The Subsonic spec allows repeated `id`/`albumId`/`artistId` for multi-select
// star/unstar — coerce whatever Fastify parsed (a bare string for one, an
// array for several) into a uniform array. Same pattern as playlists.ts.
const arr = (v: string | string[] | undefined): string[] => ([] as string[]).concat(v ?? []);
const str = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

type ItemType = 'artist' | 'album' | 'track';

function resolveItems(req: FastifyRequest): { type: ItemType; id: number }[] {
  const { id, albumId, artistId } = p(req);
  return [
    ...arr(artistId).map((v) => ({ type: 'artist' as const, id: Number(v) })),
    ...arr(albumId).map((v) => ({ type: 'album' as const, id: Number(v) })),
    ...arr(id).map((v) => ({ type: 'track' as const, id: Number(v) })),
  ];
}

function star(req: FastifyRequest, reply: FastifyReply): void {
  const f = str(p(req).f);
  const items = resolveItems(req);
  if (!items.length) return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'id, albumId, or artistId required' });

  const insert = getDb().prepare('INSERT OR IGNORE INTO favorites (user_id, item_type, item_id) VALUES (?, ?, ?)');
  for (const item of items) insert.run(req.subsonicUser!.id, item.type, item.id);

  sendOk(reply, f);
}

function unstar(req: FastifyRequest, reply: FastifyReply): void {
  const f = str(p(req).f);
  const items = resolveItems(req);
  if (!items.length) return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'id, albumId, or artistId required' });

  const del = getDb().prepare('DELETE FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ?');
  for (const item of items) del.run(req.subsonicUser!.id, item.type, item.id);

  sendOk(reply, f);
}

function getStarred2(req: FastifyRequest, reply: FastifyReply): void {
  const f = str(p(req).f);
  const db = getDb();
  const userId = req.subsonicUser!.id;

  const artists = db.prepare(`
    SELECT a.id, a.name, a.image_path,
           COUNT(DISTINCT al.id) AS albumCount,
           fav.created_at AS starred
    FROM favorites fav
    JOIN artists a ON a.id = fav.item_id
    LEFT JOIN albums al ON al.artist_id = a.id
    LEFT JOIN favorites f ON f.item_type = 'artist' AND f.item_id = a.id AND f.user_id = ?
    WHERE fav.user_id = ? AND fav.item_type = 'artist'
    GROUP BY a.id
    ORDER BY a.name
  `).all(userId, userId) as ArtistRow[];

  const albums = db.prepare(`
    SELECT al.id, al.name, al.year, al.cover_path, al.created_at,
           ar.id AS artist_id, ar.name AS artist_name,
           COUNT(t.id) AS songCount,
           COALESCE(SUM(t.duration_s), 0) AS duration,
           fav.created_at AS starred
    FROM favorites fav
    JOIN albums al ON al.id = fav.item_id
    JOIN artists ar ON ar.id = al.artist_id
    LEFT JOIN tracks t ON t.album_id = al.id
    WHERE fav.user_id = ? AND fav.item_type = 'album'
    GROUP BY al.id
    ORDER BY al.name
  `).all(userId) as AlbumRow[];

  const songs = db.prepare(`
    SELECT t.id, t.title, t.track_no, t.disc_no, t.duration_s, t.size, t.bitrate,
           t.format, t.path, t.added_at, t.album_id, t.artist_id, t.genre,
           t.sample_rate, t.bit_depth, t.channels, t.codec, t.lossless,
           t.replaygain_track, t.replaygain_album,
           ar.name AS artist_name, al.name AS album_name, al.year,
           fav.created_at AS starred
    FROM favorites fav
    JOIN tracks t ON t.id = fav.item_id
    JOIN artists ar ON ar.id = t.artist_id
    JOIN albums al ON al.id = t.album_id
    WHERE fav.user_id = ? AND fav.item_type = 'track'
    ORDER BY t.title
  `).all(userId) as SongRow[];

  sendOk(reply, f, {
    xml: xmlTag('starred2', {},
      artists.map((a) => xmlTag('artist', artistAttrs(a))).join('') +
      albums.map((a) => xmlTag('album', albumAttrs(a))).join('') +
      songs.map((s) => xmlTag('song', songAttrs(s))).join(''),
    ),
    json: {
      starred2: {
        artist: artists.map((a) => toJson(artistAttrs(a))),
        album:  albums.map((a) => toJson(albumAttrs(a))),
        song:   songs.map((s) => toJson(songAttrs(s))),
      },
    },
  });
}

export async function favoritesPlugin(app: FastifyInstance): Promise<void> {
  app.route({ method: ['GET', 'POST'], url: '/star.view', handler: star });
  app.route({ method: ['GET', 'POST'], url: '/unstar.view', handler: unstar });
  app.route({ method: ['GET', 'POST'], url: '/getStarred2.view', handler: getStarred2 });
}
