import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setCredentials, addSongToPlaylist, removeSongFromPlaylist, renamePlaylist, setPlaylistDescription,
  createPlaylistWithName, getAllSongs, setJwt, clearCredentials,
  changeMyPassword, adminDeleteTrack, savePlayQueue, getPlayQueue,
} from './subsonic';

function mockOkResponse(payload: Record<string, unknown> = { status: 'ok', searchResult3: { song: [] } }) {
  return {
    ok: true,
    json: async () => ({ 'subsonic-response': payload }),
  } as Response;
}

beforeEach(() => {
  setCredentials({ serverUrl: 'http://localhost:4533', username: 'admin', password: 'admin' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockOkResponse()));
});

describe('addSongToPlaylist', () => {
  it('calls updatePlaylist.view with playlistId and songIdToAdd', async () => {
    await addSongToPlaylist('7', '42');

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.pathname).toBe('/rest/updatePlaylist.view');
    expect(url.searchParams.get('playlistId')).toBe('7');
    expect(url.searchParams.get('songIdToAdd')).toBe('42');
  });

  it('does not send a name param (would rename the playlist instead of adding a song)', async () => {
    await addSongToPlaylist('7', '42');
    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.searchParams.has('name')).toBe(false);
  });
});

describe('removeSongFromPlaylist', () => {
  it('calls updatePlaylist.view with the track position, not a song id', async () => {
    await removeSongFromPlaylist('7', 3);

    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.pathname).toBe('/rest/updatePlaylist.view');
    expect(url.searchParams.get('playlistId')).toBe('7');
    expect(url.searchParams.get('songIndexToRemove')).toBe('3');
    expect(url.searchParams.has('songIdToAdd')).toBe(false);
  });
});

describe('renamePlaylist (regression guard: distinct from addSongToPlaylist)', () => {
  it('sends name but not songIdToAdd', async () => {
    await renamePlaylist('7', 'New Name');
    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.searchParams.get('name')).toBe('New Name');
    expect(url.searchParams.has('songIdToAdd')).toBe(false);
  });
});

describe('setPlaylistDescription', () => {
  it('sends comment (the Subsonic field name for playlist description) but not name', async () => {
    await setPlaylistDescription('7', 'Late night drives');
    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.pathname).toBe('/rest/updatePlaylist.view');
    expect(url.searchParams.get('playlistId')).toBe('7');
    expect(url.searchParams.get('comment')).toBe('Late night drives');
    expect(url.searchParams.has('name')).toBe(false);
  });
});

describe('createPlaylistWithName', () => {
  it('sends only name when no comment is given', async () => {
    await createPlaylistWithName('Road Trip');
    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.pathname).toBe('/rest/createPlaylist.view');
    expect(url.searchParams.get('name')).toBe('Road Trip');
    expect(url.searchParams.has('comment')).toBe(false);
  });

  it('includes comment when a description is given', async () => {
    await createPlaylistWithName('Road Trip', 'Windows down mix');
    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.searchParams.get('comment')).toBe('Windows down mix');
  });
});

describe('getAllSongs', () => {
  it('paginates via search3.view with an empty query and zeroed artist/album counts', async () => {
    await getAllSongs(200, 100);

    const url = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(url.pathname).toBe('/rest/search3.view');
    expect(url.searchParams.get('query')).toBe('');
    expect(url.searchParams.get('songOffset')).toBe('200');
    expect(url.searchParams.get('songCount')).toBe('100');
    expect(url.searchParams.get('artistCount')).toBe('0');
    expect(url.searchParams.get('albumCount')).toBe('0');
  });

  it('returns an empty array when the server omits the song key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockOkResponse({ status: 'ok', searchResult3: {} })));
    const songs = await getAllSongs(0, 100);
    expect(songs).toEqual([]);
  });
});

function lastCall() {
  const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
}

describe('REST /api/v1 calls (changeMyPassword, adminDeleteTrack)', () => {
  beforeEach(() => {
    setJwt('jwt-token');
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
  });

  it('changeMyPassword PATCHes users/me/password with a JSON body and the bearer token', async () => {
    await changeMyPassword('old-pw', 'new-pw');

    const { url, init } = lastCall();
    expect(url).toBe('http://localhost:4533/api/v1/users/me/password');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ currentPassword: 'old-pw', newPassword: 'new-pw' });
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer jwt-token',
      'Content-Type': 'application/json',
    });
  });

  it('adminDeleteTrack DELETEs admin/tracks/:id without a body', async () => {
    await adminDeleteTrack('tr-9');

    const { url, init } = lastCall();
    expect(url).toBe('http://localhost:4533/api/v1/admin/tracks/tr-9');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('sends no Authorization header when there is no JWT', async () => {
    setJwt(null);
    await adminDeleteTrack('tr-9');

    expect((lastCall().init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('does not double the slash when the server URL ends with one', async () => {
    setCredentials({ serverUrl: 'http://localhost:4533/', username: 'admin', password: 'admin' });
    await adminDeleteTrack('tr-9');

    expect(lastCall().url).toBe('http://localhost:4533/api/v1/admin/tracks/tr-9');
  });

  it('surfaces the server\'s error message (e.g. the 409 for a read-only folder)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Music folder is read-only' }),
    } as Response);

    await expect(adminDeleteTrack('tr-9')).rejects.toThrow('Music folder is read-only');
  });

  it('surfaces "Current password is incorrect" from a failed password change', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Current password is incorrect' }),
    } as Response);

    await expect(changeMyPassword('bad', 'new-pw')).rejects.toThrow('Current password is incorrect');
  });

  it('falls back to "HTTP <status>" when the error body is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    } as unknown as Response);

    await expect(adminDeleteTrack('tr-9')).rejects.toThrow('HTTP 502');
  });

  it('throws "Not authenticated" without credentials and never calls fetch', async () => {
    clearCredentials();
    vi.mocked(fetch).mockClear();

    await expect(changeMyPassword('a', 'b')).rejects.toThrow('Not authenticated');
    expect(fetch).not.toHaveBeenCalled();
  });
});


describe('savePlayQueue / getPlayQueue (resume where you left off)', () => {
  it('savePlayQueue POSTs the ids as a JSON body (a long queue would not fit in a URL), auth in the query', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse({ status: 'ok' }));

    await savePlayQueue(['3', '1', '2'], '1', 83_500);

    const { url, init } = (() => {
      const [u, i] = vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit];
      return { url: new URL(u), init: i };
    })();
    expect(url.pathname).toBe('/rest/savePlayQueue.view');
    expect(url.searchParams.get('u')).toBe('admin');
    expect(url.searchParams.has('id')).toBe(false);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ id: ['3', '1', '2'], current: '1', position: '83500' });
  });

  it('savePlayQueue omits `current` when there is none, and rounds the position', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse({ status: 'ok' }));

    await savePlayQueue(['1'], undefined, 1234.6);

    const body = JSON.parse((vi.mocked(fetch).mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(body).toEqual({ id: ['1'], position: '1235' });
  });

  it('savePlayQueue throws when the server refuses', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse({ status: 'failed', error: { message: 'nope' } }));
    await expect(savePlayQueue(['1'], '1', 0)).rejects.toThrow('nope');
  });

  it('getPlayQueue returns the saved songs, current id and position', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse({
      status: 'ok',
      playQueue: { current: '2', position: 42_000, changed: '2026-10-03T10:00:00Z', entry: [{ id: '1' }, { id: '2' }] },
    }));

    expect(await getPlayQueue()).toEqual({
      songs: [{ id: '1' }, { id: '2' }], current: '2', positionMs: 42_000, changed: '2026-10-03T10:00:00Z',
    });
  });

  it('getPlayQueue is null when nothing was saved (the server answers a bare ok)', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse({ status: 'ok' }));
    expect(await getPlayQueue()).toBeNull();
  });

  it('getPlayQueue is null for an empty saved queue, and tolerates a missing position', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse({ status: 'ok', playQueue: { entry: [] } }));
    expect(await getPlayQueue()).toBeNull();

    vi.mocked(fetch).mockResolvedValue(mockOkResponse({ status: 'ok', playQueue: { entry: [{ id: '1' }] } }));
    expect((await getPlayQueue())?.positionMs).toBe(0);
  });
});
