import md5 from 'blueimp-md5';
import type {
  Album,
  Artist,
  ArtistIndex,
  Credentials,
  Playlist,
  SearchResult,
  Song,
} from './types';

const CLIENT = 'riffplayer-web';
const VERSION = '1.16.1';

let _creds: Credentials | null = null;

export function setCredentials(creds: Credentials): void {
  _creds = creds;
}

export function getCredentials(): Credentials | null {
  return _creds;
}

export function clearCredentials(): void {
  _creds = null;
}

function randomSalt(): string {
  return Math.random().toString(36).slice(2, 10);
}

function authParams(creds: Credentials): URLSearchParams {
  const s = randomSalt();
  const t = md5(creds.password + s);
  const p = new URLSearchParams();
  p.set('u', creds.username);
  p.set('t', t);
  p.set('s', s);
  p.set('v', VERSION);
  p.set('c', CLIENT);
  p.set('f', 'json');
  return p;
}

/** Build a URL for endpoints that are used as media src (stream, cover art). */
export function mediaUrl(path: string, extra: Record<string, string> = {}): string {
  const creds = _creds;
  if (!creds) return '';
  const base = creds.serverUrl.replace(/\/$/, '');
  const params = authParams(creds);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `${base}/rest/${path}?${params}`;
}

export function coverArtUrl(id: string, size?: number): string {
  const extra: Record<string, string> = { id };
  if (size) extra.size = String(size);
  return mediaUrl('getCoverArt.view', extra);
}

export function streamUrl(id: string): string {
  return mediaUrl('stream.view', { id });
}

async function get<T>(path: string, extra: Record<string, string> = {}): Promise<T> {
  const creds = _creds;
  if (!creds) throw new Error('Not authenticated');
  const base = creds.serverUrl.replace(/\/$/, '');
  const params = authParams(creds);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);

  return parseSubsonic<T>(await fetch(`${base}/rest/${path}?${params}`));
}

async function parseSubsonic<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as Record<string, unknown>;
  const sr = json['subsonic-response'] as Record<string, unknown>;
  if (sr.status !== 'ok') {
    const err = sr.error as Record<string, unknown> | undefined;
    throw new Error((err?.message as string) ?? 'Subsonic error');
  }
  return sr as T;
}

/** Subsonic call with a JSON body (auth still in the query) — for payloads too long for a URL. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const creds = _creds;
  if (!creds) throw new Error('Not authenticated');
  const base = creds.serverUrl.replace(/\/$/, '');
  return parseSubsonic<T>(
    await fetch(`${base}/rest/${path}?${authParams(creds)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

// ── Saved play queue (resume where you left off) ────────────────────────────

/**
 * Stores the queue on the server (one per user) so any device can pick it up later. The ids go in a JSON
 * body: a queue of hundreds of songs would not fit in a URL.
 */
export async function savePlayQueue(ids: string[], currentId: string | undefined, positionMs: number): Promise<void> {
  await postJson('savePlayQueue.view', {
    id: ids,
    ...(currentId !== undefined ? { current: currentId } : {}),
    position: String(Math.round(positionMs)),
  });
}

export interface SavedPlayQueue {
  songs: Song[];
  current?: string;
  positionMs: number;
  /** ISO time the queue was last saved. */
  changed?: string;
}

/** The saved queue, or null when there is none (or it is empty). */
export async function getPlayQueue(): Promise<SavedPlayQueue | null> {
  const r = await get<{
    playQueue?: { entry?: Song[]; current?: string; position?: number; changed?: string };
  }>('getPlayQueue.view');
  const q = r.playQueue;
  if (!q?.entry?.length) return null;
  return { songs: q.entry, current: q.current, positionMs: q.position ?? 0, changed: q.changed };
}

// ── Ping ────────────────────────────────────────────────────────────────────

export async function ping(): Promise<void> {
  await get('ping.view');
}

// ── Browse ──────────────────────────────────────────────────────────────────

export async function getArtists(): Promise<ArtistIndex[]> {
  const r = await get<{ artists: { index: ArtistIndex[] } }>('getArtists.view');
  return r.artists.index;
}

export async function getArtist(id: string): Promise<Artist & { album: Album[] }> {
  const r = await get<{ artist: Artist & { album: Album[] } }>('getArtist.view', { id });
  return r.artist;
}

export async function getAlbumList(
  type: string,
  opts: { size?: number; offset?: number; fromYear?: number; toYear?: number; quality?: QualityFilter } = {},
): Promise<Album[]> {
  const extra: Record<string, string> = { type, size: String(opts.size ?? 50) };
  if (opts.offset) extra.offset = String(opts.offset);
  if (opts.fromYear != null) extra.fromYear = String(opts.fromYear);
  if (opts.toYear != null) extra.toYear = String(opts.toYear);
  if (opts.quality) extra.quality = opts.quality;
  const r = await get<{ albumList2: { album: Album[] } }>('getAlbumList2.view', extra);
  return r.albumList2.album ?? [];
}

export async function getAlbum(id: string): Promise<Album & { song: Song[] }> {
  const r = await get<{ album: Album & { song: Song[] } }>('getAlbum.view', { id });
  return r.album;
}

export async function getSong(id: string): Promise<Song> {
  const r = await get<{ song: Song }>('getSong.view', { id });
  return r.song;
}

// ── Search ──────────────────────────────────────────────────────────────────

export async function search(query: string): Promise<SearchResult> {
  const r = await get<{ searchResult3: SearchResult }>('search3.view', {
    query,
    artistCount: '10',
    albumCount: '20',
    songCount: '30',
  });
  return {
    artist: r.searchResult3.artist ?? [],
    album: r.searchResult3.album ?? [],
    song: r.searchResult3.song ?? [],
  };
}

export type AllSongsSort = 'title' | 'added_desc' | 'added_asc';

/** Quality filter (RiffPlayer extension): lossless files only, or Hi-Res only. */
export type QualityFilter = '' | 'lossless' | 'hires';

export async function getAllSongs(
  offset: number,
  limit: number,
  opts: { genre?: string; sort?: AllSongsSort; quality?: QualityFilter } = {},
): Promise<Song[]> {
  const params: Record<string, string> = {
    query: '',
    artistCount: '0',
    albumCount: '0',
    songCount: String(limit),
    songOffset: String(offset),
  };
  // `genre` / `sort` are RiffPlayer extensions to search3 — stock Subsonic
  // servers ignore them, so the list just comes back unfiltered there.
  if (opts.genre) params.genre = opts.genre;
  if (opts.sort) params.sort = opts.sort;
  if (opts.quality) params.quality = opts.quality;
  const r = await get<{ searchResult3: { song?: Song[] } }>('search3.view', params);
  return r.searchResult3.song ?? [];
}

export async function getGenres(): Promise<{ value: string; songCount: number }[]> {
  const r = await get<{ genres: { genre?: { value: string; songCount: number }[] } }>('getGenres.view');
  return r.genres.genre ?? [];
}

// ── Favorites ───────────────────────────────────────────────────────────────

export async function getStarred(): Promise<{ artist: Artist[]; album: Album[]; song: Song[] }> {
  const r = await get<{ starred2: { artist: Artist[]; album: Album[]; song: Song[] } }>(
    'getStarred2.view',
  );
  return {
    artist: r.starred2.artist ?? [],
    album: r.starred2.album ?? [],
    song: r.starred2.song ?? [],
  };
}

export async function star(opts: { id?: string; albumId?: string; artistId?: string }): Promise<void> {
  const extra: Record<string, string> = {};
  if (opts.id) extra.id = opts.id;
  if (opts.albumId) extra.albumId = opts.albumId;
  if (opts.artistId) extra.artistId = opts.artistId;
  await get('star.view', extra);
}

export async function unstar(opts: { id?: string; albumId?: string; artistId?: string }): Promise<void> {
  const extra: Record<string, string> = {};
  if (opts.id) extra.id = opts.id;
  if (opts.albumId) extra.albumId = opts.albumId;
  if (opts.artistId) extra.artistId = opts.artistId;
  await get('unstar.view', extra);
}

// ── Playlists ────────────────────────────────────────────────────────────────

export async function getPlaylists(): Promise<Playlist[]> {
  const r = await get<{ playlists: { playlist: Playlist[] } }>('getPlaylists.view');
  return r.playlists.playlist ?? [];
}

export async function getPlaylist(id: string): Promise<Playlist> {
  const r = await get<{ playlist: Playlist }>('getPlaylist.view', { id });
  return r.playlist;
}

// ── Scrobble ────────────────────────────────────────────────────────────────

export async function scrobble(id: string, submission = true): Promise<void> {
  await get('scrobble.view', { id, submission: String(submission) });
}

// ── Playlist management ──────────────────────────────────────────────────────

export async function deletePlaylist(id: string): Promise<void> {
  await get('deletePlaylist.view', { id });
}

export async function createPlaylistWithName(name: string, comment?: string): Promise<Playlist> {
  const extra: Record<string, string> = { name };
  if (comment) extra.comment = comment;
  const r = await get<{ playlist: Playlist }>('createPlaylist.view', extra);
  return r.playlist;
}

export async function renamePlaylist(playlistId: string, name: string): Promise<void> {
  await get('updatePlaylist.view', { playlistId, name });
}

export async function setPlaylistDescription(playlistId: string, comment: string): Promise<void> {
  await get('updatePlaylist.view', { playlistId, comment });
}

export async function addSongToPlaylist(playlistId: string, songId: string): Promise<void> {
  await get('updatePlaylist.view', { playlistId, songIdToAdd: songId });
}

// ── Custom /api/v1 endpoints (Subsonic auth via query params) ────────────────

// JWT stored by auth store — set after login
let _jwt: string | null = null;
export function setJwt(token: string | null): void { _jwt = token; }

async function apiCall(
  method: string,
  path: string,
  body?: unknown,
  form?: FormData,
): Promise<unknown> {
  const creds = _creds;
  if (!creds) throw new Error('Not authenticated');
  const base = creds.serverUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {};
  if (_jwt) headers['Authorization'] = `Bearer ${_jwt}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${base}/api/v1/${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Authenticated fetch against /api/v1 that hands back the raw Response — for streaming bodies and for
 * callers that need to react to specific status codes (apiCall throws on any non-2xx instead).
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const creds = _creds;
  if (!creds) throw new Error('Not authenticated');
  const base = creds.serverUrl.replace(/\/$/, '');
  const headers = new Headers(init.headers);
  if (_jwt) headers.set('Authorization', `Bearer ${_jwt}`);
  return fetch(`${base}/api/v1/${path}`, { ...init, headers });
}

// ── Song radio ───────────────────────────────────────────────────────────────

export type RadioSeedType = 'song' | 'artist' | 'album' | 'playlist';

/** A batch of songs for an endless radio queue. [exclude] = ids already queued. */
export async function getRadio(type: RadioSeedType, id: string, count = 30, exclude: string[] = []): Promise<Song[]> {
  const params = new URLSearchParams({ type, id, count: String(count) });
  if (exclude.length) params.set('exclude', exclude.join(','));
  const r = (await apiCall('GET', `radio?${params}`)) as { songs: Song[] };
  return r.songs ?? [];
}

// ── Share pictures (rendered on the server) ──────────────────────────────────

async function apiImage(path: string): Promise<Blob> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.blob();
}

/** A picture of one song ("story" 9:16 or "post" 4:5), ready to share. */
export function getSongShareImage(id: string, size: 'story' | 'post' = 'story'): Promise<Blob> {
  return apiImage(`share/song/${encodeURIComponent(id)}?size=${size}`);
}

export async function getPlaylistSharePages(id: string): Promise<number> {
  const r = (await apiCall('GET', `share/playlist/${encodeURIComponent(id)}/pages`)) as { pages: number };
  return r.pages;
}

/** Picture [page] (1-based) of a playlist. */
export function getPlaylistShareImage(id: string, page: number): Promise<Blob> {
  return apiImage(`share/playlist/${encodeURIComponent(id)}/page/${page}`);
}

async function apiPut(path: string, body: unknown): Promise<void> {
  await apiCall('PUT', path, body);
}

async function apiPostForm(path: string, form: FormData): Promise<void> {
  await apiCall('POST', path, undefined, form);
}

async function apiDelete(path: string): Promise<void> {
  await apiCall('DELETE', path);
}

export async function reorderPlaylistTracks(playlistId: string, trackIds: string[]): Promise<void> {
  await apiPut(`playlists/${playlistId}/tracks`, { trackIds });
}

/** When each track was added to this playlist, keyed by track id (ISO date strings). */
export async function getPlaylistTrackDates(playlistId: string): Promise<Record<string, string>> {
  const r = await apiCall('GET', `playlists/${playlistId}/track-dates`) as { dates: Record<string, string> };
  return r.dates;
}

// ── Sidebar Library pin/recency state (Phase 4) ─────────────────────────────

export type LibraryItemType = 'system' | 'playlist';

export interface LibrarySidebarItem {
  itemType: LibraryItemType;
  itemKey: string;
  pinnedAt: string | null;
  lastInteractedAt: string;
}

export async function getLibrarySidebarState(): Promise<LibrarySidebarItem[]> {
  const r = (await apiCall('GET', 'library-sidebar')) as { items: LibrarySidebarItem[] };
  return r.items;
}

export async function recordLibraryInteraction(itemType: LibraryItemType, itemKey: string): Promise<void> {
  await apiCall('POST', 'library-sidebar/interact', { itemType, itemKey });
}

export async function pinLibraryItem(itemType: LibraryItemType, itemKey: string): Promise<void> {
  await apiCall('POST', 'library-sidebar/pin', { itemType, itemKey });
}

export async function unpinLibraryItem(itemType: LibraryItemType, itemKey: string): Promise<void> {
  await apiCall('POST', 'library-sidebar/unpin', { itemType, itemKey });
}

export async function uploadPlaylistCover(playlistId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await apiPostForm(`playlists/${playlistId}/cover`, form);
}

export async function removePlaylistCover(playlistId: string): Promise<void> {
  await apiDelete(`playlists/${playlistId}/cover`);
}

export async function uploadArtistCover(artistId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await apiPostForm(`artists/${artistId}/cover`, form);
}

export async function removeArtistCover(artistId: string): Promise<void> {
  await apiDelete(`artists/${artistId}/cover`);
}

/** Library-wide totals, used for auto-generated page descriptions (e.g. All Songs). */
export async function getLibraryStats(): Promise<{ trackCount: number }> {
  return (await apiCall('GET', 'library/stats')) as { trackCount: number };
}

// ── System-view cover + description overrides (Most Played, Recently Played, ─
// Favourites, Downloaded, Discover, Wrapped) ─────────────────────────────────

export type SystemViewKey = 'favorites' | 'recent' | 'most-played' | 'downloaded' | 'discover' | 'wrapped';

export interface SystemViewSettings {
  hasCover: boolean;
  description: string | null;
}

export async function getSystemViewSettings(key: SystemViewKey): Promise<SystemViewSettings> {
  return (await apiCall('GET', `system-views/${key}`)) as SystemViewSettings;
}

export async function setSystemViewDescription(key: SystemViewKey, description: string): Promise<void> {
  await apiPut(`system-views/${key}/description`, { description });
}

export async function uploadSystemViewCover(key: SystemViewKey, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await apiPostForm(`system-views/${key}/cover`, form);
}

export async function removeSystemViewCover(key: SystemViewKey): Promise<void> {
  await apiDelete(`system-views/${key}/cover`);
}

// ── Play history ─────────────────────────────────────────────────────────────

export async function getRecentlyPlayed(): Promise<Song[]> {
  const r = await apiCall('GET', 'history/recent') as { songs: Song[] };
  return r.songs;
}

export async function getMostPlayed(): Promise<Song[]> {
  const r = await apiCall('GET', 'history/most-played') as { songs: Song[] };
  return r.songs;
}

/** The single most recently played track, or null if the user has no play history yet. */
export async function getLastPlayed(): Promise<Song | null> {
  const r = await apiCall('GET', 'history/last-played') as { song: Song | null };
  return r.song;
}

/** Tracks never played (or played longest ago) among ones old enough in the library to count. */
export async function getRediscover(): Promise<Song[]> {
  const r = await apiCall('GET', 'history/rediscover') as { songs: Song[] };
  return r.songs;
}

// ── Lyrics (OpenSubsonic extension) ─────────────────────────────────────────

export interface LyricLine {
  start: number;
  value: string;
}

export interface StructuredLyrics {
  displayArtist: string;
  displayTitle: string;
  lang: string;
  synced: boolean;
  offset: number;
  line: LyricLine[];
}

// ── Admin API ────────────────────────────────────────────────────────────────

export interface AdminUser { id: number; username: string; role: string; created_at: number; }
export interface Library { id: number; name: string; path: string; scanning: boolean; }

export async function adminGetUsers(): Promise<AdminUser[]> {
  const r = await apiCall('GET', 'admin/users') as { users: AdminUser[] };
  return r.users;
}
export async function adminCreateUser(u: { username: string; password: string; role: string }): Promise<AdminUser> {
  return (await apiCall('POST', 'admin/users', u)) as AdminUser;
}
export async function adminUpdateUser(id: number, u: { password?: string; role?: string }): Promise<void> {
  await apiCall('PATCH', `admin/users/${id}`, u);
}
export async function adminDeleteUser(id: number): Promise<void> {
  await apiCall('DELETE', `admin/users/${id}`);
}

export async function adminGetLibraries(): Promise<Library[]> {
  const r = await apiCall('GET', 'admin/libraries') as { libraries: Library[] };
  return r.libraries;
}
export async function adminAddLibrary(l: { name: string; path: string }): Promise<Library> {
  return (await apiCall('POST', 'admin/libraries', l)) as Library;
}
export async function adminDeleteLibrary(id: number): Promise<void> {
  await apiCall('DELETE', `admin/libraries/${id}`);
}

/** Permanently deletes the track's file from disk along with its library entry. */
export async function adminDeleteTrack(id: string): Promise<void> {
  await apiCall('DELETE', `admin/tracks/${id}`);
}
export async function adminScanLibrary(id: number): Promise<void> {
  await apiCall('POST', `admin/libraries/${id}/scan`);
}

export async function adminGetSettings(): Promise<Record<string, string>> {
  const r = await apiCall('GET', 'admin/settings') as { settings: Record<string, string> };
  return r.settings;
}
export async function adminPatchSettings(patch: Record<string, string | null>): Promise<void> {
  await apiCall('PATCH', 'admin/settings', patch);
}

// ── User preferences ─────────────────────────────────────────────────────────

export async function patchMyPreferences(prefs: Record<string, unknown>): Promise<void> {
  await apiCall('PATCH', 'users/me/preferences', prefs);
}

/** Credits read from a track's own tags (composer, label, ISRC, …); only what the file says is present. */
export interface TrackCredits {
  albumArtist?: string;
  artists?: string[];
  composers?: string[];
  lyricists?: string[];
  writers?: string[];
  producers?: string[];
  conductors?: string[];
  arrangers?: string[];
  engineers?: string[];
  mixers?: string[];
  remixers?: string[];
  djMixers?: string[];
  labels?: string[];
  catalogNumbers?: string[];
  isrc?: string[];
  copyright?: string;
  releaseDate?: string;
  originalYear?: number;
  bpm?: number;
  key?: string;
  mood?: string;
}

export async function getTrackCredits(id: string): Promise<TrackCredits> {
  const r = (await apiCall('GET', `tracks/${encodeURIComponent(id)}/credits`)) as { credits: TrackCredits };
  return r.credits;
}

/** The user's streaming conversion preferences (null fields = send originals). */
export async function getMyTranscodePrefs(): Promise<{ transcode_format: string | null; transcode_bitrate: number | null }> {
  const me = (await apiCall('GET', 'users/me')) as {
    preferences: { transcode_format: string | null; transcode_bitrate: number | null } | null;
  };
  return {
    transcode_format: me.preferences?.transcode_format ?? null,
    transcode_bitrate: me.preferences?.transcode_bitrate ?? null,
  };
}

/** Throws with the server's message (e.g. "Current password is incorrect") on failure. */
export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiCall('PATCH', 'users/me/password', { currentPassword, newPassword });
}

// ── Lyrics ────────────────────────────────────────────────────────────────────

// ── Recommendations & Wrapped ─────────────────────────────────────────────────

export interface WrappedStats {
  year: number;
  totalPlays: number;
  totalMinutes: number;
  topTracks: {
    id: string; title: string; artist: string; artistId: string;
    album: string; albumId: string; coverArt: string; playCount: number;
  }[];
  topArtists: { id: string; name: string; coverArt: string | null; playCount: number }[];
  topAlbums: { id: string; name: string; artist: string; coverArt: string; playCount: number }[];
  byMonth: { month: number; plays: number }[];
}

export async function getRecommendations(type: 'similar' | 'discover'): Promise<{ songs: Song[]; source: string }> {
  const r = await apiCall('GET', `recommendations/${type}`) as { songs: Song[]; source: string };
  return r;
}

export async function getWrapped(year?: number): Promise<WrappedStats> {
  const path = year ? `recommendations/wrapped?year=${year}` : 'recommendations/wrapped';
  return (await apiCall('GET', path)) as WrappedStats;
}

export async function generateWrappedSummary(year?: number): Promise<string> {
  const path = year ? `recommendations/wrapped/summary?year=${year}` : 'recommendations/wrapped/summary';
  const r = await apiCall('POST', path) as { summary: string };
  return r.summary;
}

// ── Lyrics (OpenSubsonic extension) ──────────────────────────────────────────

export async function getLyrics(songId: string): Promise<StructuredLyrics | null> {
  try {
    const r = await get<{ lyricsList?: { structuredLyrics?: StructuredLyrics[] } }>(
      'getLyricsBySongId.view',
      { id: songId },
    );
    return r.lyricsList?.structuredLyrics?.[0] ?? null;
  } catch {
    return null;
  }
}
