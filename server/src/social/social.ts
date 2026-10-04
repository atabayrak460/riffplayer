import { getDb } from '../db/database.js';
import { isSettingEnabled } from '../settings.js';
import { SONG_SELECT_LIST, SONG_FROM } from '../routes/subsonic/endpoints/browse.js';
import { songAttrs, toJson, type SongRow } from '../routes/subsonic/serialize.js';
import { PLAYLIST_QUERY, playlistAttrs, type PlaylistRow } from '../routes/subsonic/endpoints/playlists.js';

// Social features. Privacy rules, in order of importance:
//   1. What a user is listening to is shown to others ONLY if that user switched it on themselves
//      (users.show_listening, off by default) — and only while they are actually playing.
//   2. Only PUBLIC playlists of other users are ever visible; private ones never leave their owner.
//   3. The admin can switch every social feature off for the whole server (`social_enabled`).
// Note for the docs: the server admin can already read everyone's play history in the database;
// this feature adds no new access for them, it only lets members see each other.

export const SOCIAL_SETTING = 'social_enabled';
export const socialEnabled = () => isSettingEnabled(SOCIAL_SETTING);

/** A play counts as "now" from its start until the song's length (plus a little slack) has passed. */
const NOW_SLACK_S = 30;
const NOW_MAX_AGE_S = 60 * 60;
const FALLBACK_LENGTH_S = 300;

export const MAX_DISPLAY_NAME = 40;
export const MAX_BIO = 200;

// Profile text is untrusted: no control characters or text-direction overrides (which can make one
// person's name look like another's), trimmed and length-capped.
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = [...value]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return !(c < 32 || c === 127 || (c >= 0x200e && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069));
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return text || null;
}

export interface Person {
  id: number;
  username: string;
  displayName: string;
  bio: string | null;
  hasAvatar: boolean;
  /** Changes whenever the avatar does, so clients can cache by it. */
  avatarVersion: number | null;
  isMe: boolean;
  nowListening: Record<string, unknown> | null;
  publicPlaylistCount: number;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_path: string | null;
  show_listening: number;
}

function nowListening(userId: number, viewerId: number, now: number): Record<string, unknown> | null {
  const row = getDb()
    .prepare(
      `SELECT ${SONG_SELECT_LIST}, ph.played_at AS playedAt, t.duration_s AS dur
       ${SONG_FROM}
       JOIN play_history ph ON ph.track_id = t.id AND ph.user_id = ?
       ORDER BY ph.played_at DESC LIMIT 1`,
    )
    .get(viewerId, userId) as (SongRow & { playedAt: number; dur: number | null }) | undefined;
  if (!row) return null;
  const length = row.dur && row.dur > 0 ? row.dur : FALLBACK_LENGTH_S;
  const age = now - row.playedAt;
  if (age > NOW_MAX_AGE_S || age > length + NOW_SLACK_S) return null;
  return { ...toJson(songAttrs(row)), startedAt: row.playedAt };
}

function toPerson(u: UserRow, viewerId: number, now: number): Person {
  const db = getDb();
  const publicPlaylistCount = (db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE owner_id = ? AND is_public = 1').get(u.id) as { n: number }).n;
  const sharing = u.id === viewerId || u.show_listening === 1; // you always see your own
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.username,
    bio: u.bio,
    hasAvatar: !!u.avatar_path,
    avatarVersion: u.avatar_path ? avatarVersion(u.id) : null,
    isMe: u.id === viewerId,
    nowListening: sharing ? nowListening(u.id, viewerId, now) : null,
    publicPlaylistCount,
  };
}

function avatarVersion(userId: number): number {
  const row = getDb().prepare('SELECT avatar_updated_at AS v FROM users WHERE id = ?').get(userId) as { v?: number } | undefined;
  return row?.v ?? 0;
}

export function listPeople(viewerId: number, now = Math.floor(Date.now() / 1000)): Person[] {
  const users = getDb()
    .prepare('SELECT id, username, display_name, bio, avatar_path, show_listening FROM users ORDER BY LOWER(COALESCE(display_name, username))')
    .all() as UserRow[];
  return users.map((u) => toPerson(u, viewerId, now));
}

export interface Profile extends Person {
  playlists: Record<string, unknown>[];
}

export function getProfile(userId: number, viewerId: number, now = Math.floor(Date.now() / 1000)): Profile | null {
  const db = getDb();
  const user = db
    .prepare('SELECT id, username, display_name, bio, avatar_path, show_listening FROM users WHERE id = ?')
    .get(userId) as UserRow | undefined;
  if (!user) return null;

  // Someone else's profile shows their PUBLIC playlists only; your own shows everything you have.
  const rows = db
    .prepare(`${PLAYLIST_QUERY} WHERE p.owner_id = ? ${userId === viewerId ? '' : 'AND p.is_public = 1'} GROUP BY p.id ORDER BY p.name`)
    .all(userId) as PlaylistRow[];
  const playlists = rows.map((r) => toJson(playlistAttrs(r, viewerId)));
  return { ...toPerson(user, viewerId, now), playlists };
}
