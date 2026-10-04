import { qualityCondition } from '../qualityFilter.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../../db/database.js';
import { sendOk, sendError, SubsonicErrorCode } from '../response.js';
import {
  IGNORED_ARTICLES,
  indexLetter,
  xmlTag,
  artistAttrs,
  albumAttrs,
  songAttrs,
  toJson,
  escText,
  type ArtistRow,
  type AlbumRow,
  type SongRow,
} from '../serialize.js';

type Q = Record<string, string | undefined>;
const p = (req: FastifyRequest) => ({ ...(req.query as Q), ...((req.body as Q) ?? {}) });

// ── Shared DB queries ─────────────────────────────────────────────────────────

// NOTE: GROUP BY is intentionally omitted from these templates — each usage
// appends WHERE ... GROUP BY in the correct order.
const ARTIST_COLS = `
  a.id, a.name, a.image_path,
  COUNT(DISTINCT al.id) AS albumCount,
  f.created_at AS starred
FROM artists a
LEFT JOIN albums al ON al.artist_id = a.id
LEFT JOIN favorites f ON f.item_type = 'artist' AND f.item_id = a.id AND f.user_id = ?`;

const ALBUM_COLS = `
  al.id, al.name, al.year, al.cover_path, al.created_at,
  ar.id AS artist_id, ar.name AS artist_name,
  COUNT(t.id) AS songCount,
  COALESCE(SUM(t.duration_s), 0) AS duration,
  f.created_at AS starred
FROM albums al
JOIN artists ar ON ar.id = al.artist_id
LEFT JOIN tracks t ON t.album_id = al.id
LEFT JOIN favorites f ON f.item_type = 'album' AND f.item_id = al.id AND f.user_id = ?`;

// Column list only, for queries that need to append additional SELECT expressions
// (e.g. an aggregate like COUNT(...)) before the FROM/JOIN clause.
export const SONG_SELECT_LIST = `
  t.id, t.title, t.track_no, t.disc_no, t.duration_s, t.size, t.bitrate,
  t.format, t.path, t.added_at, t.album_id, t.artist_id, t.genre,
  t.sample_rate, t.bit_depth, t.channels, t.codec, t.lossless,
  t.replaygain_track, t.replaygain_album,
  ar.name AS artist_name, al.name AS album_name, al.year,
  f.created_at AS starred`;

export const SONG_FROM = `
FROM tracks t
JOIN artists ar ON ar.id = t.artist_id
JOIN albums al ON al.id = t.album_id
LEFT JOIN favorites f ON f.item_type = 'track' AND f.item_id = t.id AND f.user_id = ?`;

export const SONG_COLS = `${SONG_SELECT_LIST}${SONG_FROM}`;

// ── Handlers ──────────────────────────────────────────────────────────────────

function getLicense(req: FastifyRequest, reply: FastifyReply): void {
  const { f } = p(req);
  const attrs = { valid: true, email: '', licenseExpires: '2099-12-31T00:00:00' };
  sendOk(reply, f, {
    xml: xmlTag('license', attrs),
    json: { license: toJson(attrs) },
  });
}

// Extensions this server actually implements, per
// https://opensubsonic.netlify.app/docs/extensions/ — keep in sync with reality,
// don't advertise something the routes below don't do.
const OPEN_SUBSONIC_EXTENSIONS: { name: string; versions: number[] }[] = [
  { name: 'apiKeyAuthentication', versions: [1] }, // subsonicAuth's apiKey branch
  { name: 'songLyrics', versions: [1] }, // getLyricsBySongId.view
];

function getOpenSubsonicExtensions(req: FastifyRequest, reply: FastifyReply): void {
  const { f } = p(req);
  sendOk(reply, f, {
    xml: OPEN_SUBSONIC_EXTENSIONS.map((e) =>
      xmlTag('openSubsonicExtensions', { name: e.name, versions: e.versions.join(',') }),
    ).join(''),
    json: {
      openSubsonicExtensions: OPEN_SUBSONIC_EXTENSIONS.map((e) => ({
        name: e.name,
        versions: e.versions,
      })),
    },
  });
}

function getMusicFolders(req: FastifyRequest, reply: FastifyReply): void {
  const { f } = p(req);
  const db = getDb();
  const rows = db.prepare('SELECT id, name FROM libraries').all() as {
    id: number;
    name: string;
  }[];
  // Always expose at least one folder so clients don't bail on an empty list
  const folders = rows.length
    ? rows
    : [{ id: 1, name: 'Music' }];

  sendOk(reply, f, {
    xml: xmlTag('musicFolders', {}, folders.map((r) => xmlTag('musicFolder', { id: r.id, name: r.name })).join('')),
    json: { musicFolders: { musicFolder: folders.map((r) => ({ id: r.id, name: r.name })) } },
  });
}

function getIndexes(req: FastifyRequest, reply: FastifyReply): void {
  const { f, musicFolderId } = p(req);
  const db = getDb();
  const userId = req.subsonicUser!.id;

  const artists = db
    .prepare(`SELECT ${ARTIST_COLS} GROUP BY a.id ORDER BY a.name`)
    .all(userId) as ArtistRow[];

  const byLetter = new Map<string, ArtistRow[]>();
  for (const artist of artists) {
    const letter = indexLetter(artist.name);
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter)!.push(artist);
  }

  const sortedLetters = [...byLetter.keys()].sort();

  const indexesXml = sortedLetters
    .map((letter) => {
      const inner = byLetter.get(letter)!.map((a) => xmlTag('artist', artistAttrs(a))).join('');
      return xmlTag('index', { name: letter }, inner);
    })
    .join('');

  const indexesJson = sortedLetters.map((letter) => ({
    name: letter,
    artist: byLetter.get(letter)!.map((a) => toJson(artistAttrs(a))),
  }));

  const wrapAttrs = {
    lastModified: Date.now(),
    ignoredArticles: IGNORED_ARTICLES,
    ...(musicFolderId ? { musicFolderId } : {}),
  };

  sendOk(reply, f, {
    xml: xmlTag('indexes', wrapAttrs, indexesXml),
    json: { indexes: { ...wrapAttrs, index: indexesJson } },
  });
}

function getMusicDirectory(req: FastifyRequest, reply: FastifyReply): void {
  const { f, id } = p(req);
  if (!id) return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'id required' });

  const db = getDb();
  const userId = req.subsonicUser!.id;
  const numId = Number(id);

  // Try artist first
  const artist = db
    .prepare('SELECT id, name FROM artists WHERE id = ?')
    .get(numId) as { id: number; name: string } | undefined;

  if (artist) {
    const albums = db
      .prepare(`SELECT ${ALBUM_COLS} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year, al.name`)
      .all(userId, numId) as AlbumRow[];
    const childrenXml = albums.map((a) => xmlTag('child', { ...albumAttrs(a), isDir: true, parent: id })).join('');
    const childrenJson = albums.map((a) => ({ ...toJson(albumAttrs(a)), isDir: true, parent: id }));
    return sendOk(reply, f, {
      xml: xmlTag('directory', { id, name: artist.name }, childrenXml),
      json: { directory: { id, name: artist.name, child: childrenJson } },
    });
  }

  // Try album
  const album = db
    .prepare('SELECT al.id, al.name, al.artist_id FROM albums al WHERE al.id = ?')
    .get(numId) as { id: number; name: string; artist_id: number } | undefined;

  if (album) {
    const songs = db
      .prepare(`SELECT ${SONG_COLS} WHERE t.album_id = ? ORDER BY t.disc_no, t.track_no`)
      .all(userId, numId) as SongRow[];
    const childrenXml = songs.map((s) => xmlTag('child', { ...songAttrs(s), isDir: false, parent: id })).join('');
    const childrenJson = songs.map((s) => ({ ...toJson(songAttrs(s)), isDir: false, parent: id }));
    return sendOk(reply, f, {
      xml: xmlTag('directory', { id, name: album.name }, childrenXml),
      json: { directory: { id, name: album.name, child: childrenJson } },
    });
  }

  sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Directory not found' });
}

function getArtists(req: FastifyRequest, reply: FastifyReply): void {
  const { f } = p(req);
  const db = getDb();
  const userId = req.subsonicUser!.id;

  const artists = db
    .prepare(`SELECT ${ARTIST_COLS} GROUP BY a.id ORDER BY a.name`)
    .all(userId) as ArtistRow[];

  const byLetter = new Map<string, ArtistRow[]>();
  for (const artist of artists) {
    const letter = indexLetter(artist.name);
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter)!.push(artist);
  }
  const sortedLetters = [...byLetter.keys()].sort();

  const indexXml = sortedLetters
    .map((l) =>
      xmlTag('index', { name: l }, byLetter.get(l)!.map((a) => xmlTag('artist', artistAttrs(a))).join('')),
    )
    .join('');
  const indexJson = sortedLetters.map((l) => ({
    name: l,
    artist: byLetter.get(l)!.map((a) => toJson(artistAttrs(a))),
  }));

  const wrapAttrs = { lastModified: Date.now(), ignoredArticles: IGNORED_ARTICLES };
  sendOk(reply, f, {
    xml: xmlTag('artists', wrapAttrs, indexXml),
    json: { artists: { ...wrapAttrs, index: indexJson } },
  });
}

function getArtist(req: FastifyRequest, reply: FastifyReply): void {
  const { f, id } = p(req);
  if (!id) return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'id required' });

  const db = getDb();
  const userId = req.subsonicUser!.id;
  const numId = Number(id);

  const artist = db
    .prepare(`SELECT ${ARTIST_COLS} WHERE a.id = ? GROUP BY a.id`)
    .get(userId, numId) as ArtistRow | undefined;
  if (!artist) return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Artist not found' });

  const albums = db
    .prepare(`SELECT ${ALBUM_COLS} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year, al.name`)
    .all(userId, numId) as AlbumRow[];

  const albumsXml = albums.map((a) => xmlTag('album', albumAttrs(a))).join('');
  const artistXml = xmlTag('artist', { ...artistAttrs(artist), albumCount: artist.albumCount }, albumsXml);

  sendOk(reply, f, {
    xml: artistXml,
    json: { artist: { ...toJson(artistAttrs(artist)), album: albums.map((a) => toJson(albumAttrs(a))) } },
  });
}

function getAlbum(req: FastifyRequest, reply: FastifyReply): void {
  const { f, id } = p(req);
  if (!id) return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'id required' });

  const db = getDb();
  const userId = req.subsonicUser!.id;
  const numId = Number(id);

  const album = db
    .prepare(`SELECT ${ALBUM_COLS} WHERE al.id = ? GROUP BY al.id`)
    .get(userId, numId) as AlbumRow | undefined;
  if (!album) return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Album not found' });

  const songs = db
    .prepare(`SELECT ${SONG_COLS} WHERE t.album_id = ? ORDER BY t.disc_no, t.track_no`)
    .all(userId, numId) as SongRow[];

  const songsXml = songs.map((s) => xmlTag('song', songAttrs(s))).join('');
  const albumXml = xmlTag('album', albumAttrs(album), songsXml);

  sendOk(reply, f, {
    xml: albumXml,
    json: { album: { ...toJson(albumAttrs(album)), song: songs.map((s) => toJson(songAttrs(s))) } },
  });
}

function getSong(req: FastifyRequest, reply: FastifyReply): void {
  const { f, id } = p(req);
  if (!id) return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'id required' });

  const db = getDb();
  const userId = req.subsonicUser!.id;

  const song = db
    .prepare(`SELECT ${SONG_COLS} WHERE t.id = ?`)
    .get(userId, Number(id)) as SongRow | undefined;
  if (!song) return sendError(reply, f, { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Song not found' });

  sendOk(reply, f, {
    xml: xmlTag('song', songAttrs(song)),
    json: { song: toJson(songAttrs(song)) },
  });
}

function getAlbumList2(req: FastifyRequest, reply: FastifyReply): void {
  const { f, type = 'alphabeticalByName', size = '10', offset = '0', fromYear, toYear, genre, quality } = p(req);
  const db = getDb();
  const userId = req.subsonicUser!.id;
  const lim = Math.min(Number(size), 500);
  const off = Number(offset);

  let orderBy: string;
  let extraJoin = '';
  let extraWhere = '';
  // Bound values for extraWhere's `?` placeholders (currently only used by
  // 'byYear') — kept separate from `params` below so they can be spliced in
  // at the right position regardless of which branch ran.
  const extraParams: (number | string)[] = [];

  switch (type) {
    case 'newest':          orderBy = 'al.created_at DESC'; break;
    case 'alphabeticalByName':  orderBy = 'al.name'; break;
    case 'alphabeticalByArtist': orderBy = 'ar.name, al.name'; break;
    case 'byYear':
      if (fromYear && toYear) {
        const fy = Number(fromYear);
        const ty = Number(toYear);
        const asc = fy <= ty;
        extraWhere = 'AND al.year BETWEEN ? AND ?';
        extraParams.push(Math.min(fy, ty), Math.max(fy, ty));
        orderBy = asc ? 'al.year ASC, al.name' : 'al.year DESC, al.name';
      } else {
        orderBy = 'al.year DESC, al.name';
      }
      break;
    case 'byGenre':
      if (!genre) return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'genre required' });
      // Filter which albums qualify via a subquery rather than restricting
      // the LEFT JOIN tracks t below directly — the latter would also
      // exclude that album's non-matching-genre tracks from the
      // songCount/duration aggregates, undercounting a mixed-genre album.
      extraWhere = 'AND al.id IN (SELECT album_id FROM tracks WHERE genre = ?)';
      extraParams.push(genre);
      orderBy = 'al.name';
      break;
    case 'starred':
      extraWhere = 'AND f.created_at IS NOT NULL';
      orderBy = 'f.created_at DESC';
      break;
    case 'recent':
      extraJoin = 'LEFT JOIN play_history ph ON ph.track_id IN (SELECT id FROM tracks WHERE album_id = al.id) AND ph.user_id = ?';
      orderBy = 'MAX(ph.played_at) DESC';
      break;
    case 'frequent':
      extraJoin = 'LEFT JOIN play_history ph ON ph.track_id IN (SELECT id FROM tracks WHERE album_id = al.id) AND ph.user_id = ?';
      orderBy = 'COUNT(ph.id) DESC';
      break;
    case 'random':
      orderBy = 'RANDOM()';
      break;
    default:
      orderBy = 'al.name';
  }

  // Quality filter: via a subquery for the same reason as byGenre above — an album
  // with some qualifying tracks keeps its full songCount/duration.
  const qualitySql = qualityCondition(quality);
  if (qualitySql) {
    extraWhere += ` AND al.id IN (SELECT t.album_id FROM tracks t WHERE ${qualitySql})`;
  }

  const needsPlayHistory = type === 'recent' || type === 'frequent';
  const params = [userId, ...(needsPlayHistory ? [userId] : []), ...extraParams];

  const albums = db
    .prepare(`
      SELECT al.id, al.name, al.year, al.cover_path, al.created_at,
             ar.id AS artist_id, ar.name AS artist_name,
             COUNT(DISTINCT t.id) AS songCount,
             COALESCE(SUM(t.duration_s), 0) AS duration,
             f.created_at AS starred
      FROM albums al
      JOIN artists ar ON ar.id = al.artist_id
      LEFT JOIN tracks t ON t.album_id = al.id
      LEFT JOIN favorites f ON f.item_type = 'album' AND f.item_id = al.id AND f.user_id = ?
      ${extraJoin}
      WHERE 1=1 ${extraWhere}
      GROUP BY al.id
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `)
    .all(...params, lim, off) as AlbumRow[];

  const albumsXml = albums.map((a) => xmlTag('album', albumAttrs(a))).join('');
  sendOk(reply, f, {
    xml: xmlTag('albumList2', {}, albumsXml),
    json: { albumList2: { album: albums.map((a) => toJson(albumAttrs(a))) } },
  });
}

function getRandomSongs(req: FastifyRequest, reply: FastifyReply): void {
  const { f, size = '10', genre, fromYear, toYear } = p(req);
  // `musicFolderId` is accepted-but-ignored: only ever one effective music
  // folder today, so filtering on it would just silently return nothing for
  // clients that pass it — no-op is the safer default over an error.
  const db = getDb();
  const userId = req.subsonicUser!.id;
  const lim = Math.min(Number(size) || 10, 500);

  const conditions: string[] = [];
  const params: (number | string)[] = [userId];
  if (fromYear && toYear) {
    const fy = Number(fromYear);
    const ty = Number(toYear);
    conditions.push('al.year BETWEEN ? AND ?');
    params.push(Math.min(fy, ty), Math.max(fy, ty));
  }
  if (genre) {
    conditions.push('t.genre = ?');
    params.push(genre);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const songs = db
    .prepare(`SELECT ${SONG_COLS} ${where} ORDER BY RANDOM() LIMIT ?`)
    .all(...params, lim) as SongRow[];

  sendOk(reply, f, {
    xml: xmlTag('randomSongs', {}, songs.map((s) => xmlTag('song', songAttrs(s))).join('')),
    json: { randomSongs: { song: songs.map((s) => toJson(songAttrs(s))) } },
  });
}

function getTopSongs(req: FastifyRequest, reply: FastifyReply): void {
  const { f, artist, count = '50' } = p(req);
  if (!artist) return sendError(reply, f, { code: SubsonicErrorCode.MISSING_PARAM, message: 'artist required' });

  const db = getDb();
  const userId = req.subsonicUser!.id;
  const lim = Math.min(Number(count) || 50, 500);

  // No external popularity/charting data (privacy-first, no phoning home) —
  // "top" is this server's own play_history, same signal the rest of the
  // app already uses for "frequent"/most-played.
  const songs = db
    .prepare(`
      SELECT ${SONG_SELECT_LIST}${SONG_FROM}
      LEFT JOIN play_history ph ON ph.track_id = t.id AND ph.user_id = ?
      WHERE ar.name = ? COLLATE NOCASE
      GROUP BY t.id
      ORDER BY COUNT(ph.id) DESC, t.title
      LIMIT ?
    `)
    .all(userId, userId, artist, lim) as SongRow[];

  sendOk(reply, f, {
    xml: xmlTag('topSongs', {}, songs.map((s) => xmlTag('song', songAttrs(s))).join('')),
    json: { topSongs: { song: songs.map((s) => toJson(songAttrs(s))) } },
  });
}

function getGenres(req: FastifyRequest, reply: FastifyReply): void {
  const { f } = p(req);
  const db = getDb();

  const rows = db
    .prepare(`
      SELECT t.genre AS value,
             COUNT(DISTINCT t.id) AS songCount,
             COUNT(DISTINCT t.album_id) AS albumCount
      FROM tracks t
      WHERE t.genre IS NOT NULL AND t.genre != ''
      GROUP BY t.genre
      ORDER BY t.genre COLLATE NOCASE
    `)
    .all() as { value: string; songCount: number; albumCount: number }[];

  sendOk(reply, f, {
    xml: xmlTag('genres', {}, rows.map((r) => xmlTag('genre', { songCount: r.songCount, albumCount: r.albumCount }, escText(r.value))).join('')),
    json: { genres: { genre: rows } },
  });
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export async function browsePlugin(app: FastifyInstance): Promise<void> {
  const route = (url: string, handler: (req: FastifyRequest, reply: FastifyReply) => void) =>
    app.route({ method: ['GET', 'POST'], url, handler });

  route('/getLicense.view', getLicense);
  route('/getOpenSubsonicExtensions.view', getOpenSubsonicExtensions);
  route('/getMusicFolders.view', getMusicFolders);
  route('/getIndexes.view', getIndexes);
  route('/getMusicDirectory.view', getMusicDirectory);
  route('/getArtists.view', getArtists);
  route('/getArtist.view', getArtist);
  route('/getAlbum.view', getAlbum);
  route('/getSong.view', getSong);
  route('/getAlbumList2.view', getAlbumList2);
  route('/getRandomSongs.view', getRandomSongs);
  route('/getTopSongs.view', getTopSongs);
  route('/getGenres.view', getGenres);
}
