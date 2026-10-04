// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DragEndEvent } from '@dnd-kit/core';
import { PlaylistDetailPage } from './PlaylistDetailPage';
import { usePlayerStore } from '../store/player';
import { useDownloadsStore } from '../store/downloads';
import * as subsonic from '../api/subsonic';
import type { Playlist, Song } from '../api/types';

// Capture the page's drag-end handler so a reorder can be simulated without
// real pointer drags (the index math itself is covered by dragReorder.test).
let dragEnd: ((e: DragEndEvent) => void) | undefined;
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (e: DragEndEvent) => void }) => {
      dragEnd = onDragEnd;
      return <>{children}</>;
    },
  };
});

vi.mock('../components/SongRow', () => ({
  SongRow: ({ song, index, addedAt }: { song: Song; index: number; addedAt?: string }) => (
    <div data-testid="row">{`${index}. ${song.title}${addedAt ? ` @${addedAt}` : ''}`}</div>
  ),
}));
vi.mock('../components/CoverUploadControl', () => ({
  CoverUploadControl: (p: {
    hasCover: boolean; error?: string | null;
    onUpload: (f: File) => void; onRemove: () => void;
  }) => (
    <div>
      <span>{p.hasCover ? 'has cover' : 'no cover'}</span>
      <button onClick={() => p.onUpload(new File(['x'], 'c.png'))}>upload cover</button>
      <button onClick={p.onRemove}>remove cover</button>
      {p.error && <span>{p.error}</span>}
    </div>
  ),
}));
vi.mock('../components/StockCovers', () => ({ PlaylistCover: () => null }));

const song = (id: string) => ({ id, title: `Song ${id}`, artist: 'A', album: 'B' }) as Song;
const songs = ['a', 'b', 'c'].map(song);

const playlist = (extra: Partial<Playlist> = {}): Playlist => ({
  id: 'p1', name: 'Road trip', owner: 'admin', songCount: 3, duration: 3900,
  public: false, created: '', changed: '', entry: songs, ...extra,
});

const playQueue = vi.fn();
const requestDownload = vi.fn();
const removePlaylistDownload = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/playlists/p1']}>
        <Routes>
          <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
          <Route path="/playlists" element={<p>playlists index</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rows = () => screen.getAllByTestId('row').map((r) => r.textContent);

beforeEach(() => {
  vi.restoreAllMocks();
  dragEnd = undefined;
  playQueue.mockClear();
  requestDownload.mockClear();
  removePlaylistDownload.mockClear();
  usePlayerStore.setState({ playQueue });
  useDownloadsStore.setState({ status: {}, requestDownload, removePlaylistDownload });
  vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue(playlist());
  vi.spyOn(subsonic, 'getPlaylistTrackDates').mockResolvedValue({ a: '2024-03-01', b: '2024-01-01', c: '2024-02-01' });
  vi.spyOn(subsonic, 'renamePlaylist').mockResolvedValue(undefined as never);
  vi.spyOn(subsonic, 'setPlaylistDescription').mockResolvedValue(undefined as never);
  vi.spyOn(subsonic, 'deletePlaylist').mockResolvedValue(undefined as never);
  vi.spyOn(subsonic, 'reorderPlaylistTracks').mockResolvedValue(undefined as never);
  vi.spyOn(subsonic, 'uploadPlaylistCover').mockResolvedValue(undefined as never);
  vi.spyOn(subsonic, 'removePlaylistCover').mockResolvedValue(undefined as never);
});

describe('PlaylistDetailPage — states', () => {
  it('shows Loading… first', () => {
    renderPage();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows "Playlist not found." when the fetch fails', async () => {
    vi.spyOn(subsonic, 'getPlaylist').mockRejectedValue(new Error('404'));
    renderPage();
    expect(await screen.findByText('Playlist not found.')).toBeInTheDocument();
  });

  it('shows header info and the tracks in saved order', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Road trip' })).toBeInTheDocument();
    expect(screen.getByText(/admin · 3 tracks · 1 hr 5 min/)).toBeInTheDocument();
    expect(rows().map((r) => r!.split(' @')[0])).toEqual(['1. Song a', '2. Song b', '3. Song c']);
  });

  it('says "1 track" for a single-track playlist', async () => {
    vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue(playlist({ entry: [songs[0]], songCount: 1, duration: 120 }));
    renderPage();

    expect(await screen.findByText(/admin · 1 track · 2 min/)).toBeInTheDocument();
  });

  it('formats a sub-hour duration without hours', async () => {
    vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue(playlist({ duration: 2400 }));
    renderPage();
    expect(await screen.findByText(/· 40 min/)).toBeInTheDocument();
  });

  it('empty playlist: no duration, no sort buttons, disabled Play, "No tracks yet."', async () => {
    vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue(playlist({ entry: [], songCount: 0, duration: 0 }));
    renderPage();

    expect(await screen.findByText('No tracks yet.')).toBeInTheDocument();
    expect(screen.getByText(/admin · 0 tracks$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Custom order' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('treats a playlist without an entry field as empty', async () => {
    vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue(playlist({ entry: undefined }));
    renderPage();
    expect(await screen.findByText('No tracks yet.')).toBeInTheDocument();
  });

  it('passes each track\'s date-added to its row', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Road trip' });
    await waitFor(() => expect(rows()).toContain('1. Song a @2024-03-01'));
  });
});

describe('PlaylistDetailPage — playing and sorting', () => {
  it('Play queues the playlist in custom order', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Play' }));
    expect(playQueue).toHaveBeenCalledWith(songs);
  });

  it('"Date added: newest first" reorders the rows and what Play queues', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Road trip' });
    await waitFor(() => expect(subsonic.getPlaylistTrackDates).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Date added: newest first' }));
    await waitFor(() => expect(rows()[0]).toMatch(/Song a/)); // 03-01
    expect(rows().map((r) => r!.match(/Song \w/)![0])).toEqual(['Song a', 'Song c', 'Song b']);

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(playQueue.mock.calls[0][0].map((s: Song) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('"Date added: oldest first" reverses it, and "Custom order" restores the saved order', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Road trip' });
    await waitFor(() => expect(rows()).toContain('1. Song a @2024-03-01'));

    await userEvent.click(screen.getByRole('button', { name: 'Date added: oldest first' }));
    expect(rows().map((r) => r!.match(/Song \w/)![0])).toEqual(['Song b', 'Song c', 'Song a']);

    await userEvent.click(screen.getByRole('button', { name: 'Custom order' }));
    expect(rows().map((r) => r!.match(/Song \w/)![0])).toEqual(['Song a', 'Song b', 'Song c']);
  });

  it('sorting never saves anything to the server', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Date added: oldest first' }));

    expect(subsonic.reorderPlaylistTracks).not.toHaveBeenCalled();
  });
});

describe('PlaylistDetailPage — renaming and description', () => {
  it('clicking the title opens a prefilled input; Save renames', async () => {
    renderPage();
    await userEvent.click(await screen.findByTitle('Click to rename'));
    const input = screen.getByDisplayValue('Road trip');

    await userEvent.clear(input);
    await userEvent.type(input, 'Summer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(subsonic.renamePlaylist).toHaveBeenCalledWith('p1', 'Summer'));
    await waitFor(() => expect(screen.queryByDisplayValue('Summer')).not.toBeInTheDocument());
  });

  it('Cancel leaves the name alone', async () => {
    renderPage();
    await userEvent.click(await screen.findByTitle('Click to rename'));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(subsonic.renamePlaylist).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeInTheDocument();
  });

  it('shows a placeholder when there is no description and saves a new one', async () => {
    renderPage();
    expect(await screen.findByText('No description')).toBeInTheDocument();

    await userEvent.click(screen.getByTitle('Click to edit description'));
    await userEvent.type(screen.getByPlaceholderText('Add a description…'), 'Long drives');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(subsonic.setPlaylistDescription).toHaveBeenCalledWith('p1', 'Long drives'));
  });

  it('editing an existing description starts from its current text', async () => {
    vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue(playlist({ comment: 'Old text' }));
    renderPage();

    await userEvent.click(await screen.findByTitle('Click to edit description'));

    expect(screen.getByPlaceholderText('Add a description…')).toHaveValue('Old text');
  });
});

describe('PlaylistDetailPage — delete, download, cover', () => {
  it('Delete confirms, deletes and returns to the playlists list', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete "Road trip"?');
    expect(await screen.findByText('playlists index')).toBeInTheDocument();
    expect(subsonic.deletePlaylist).toHaveBeenCalledWith('p1');
  });

  it('declining the confirmation deletes nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(subsonic.deletePlaylist).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeInTheDocument();
  });

  it('Download requests the playlist with its tracks', async () => {
    renderPage();
    await userEvent.click(await screen.findByTitle('Download'));

    expect(requestDownload).toHaveBeenCalledWith({
      kind: 'playlist', playlist: expect.objectContaining({ id: 'p1' }), songs,
    });
  });

  it('a downloaded playlist offers Remove download', async () => {
    useDownloadsStore.setState({ status: { 'p:p1': 'downloaded' } });
    renderPage();

    await userEvent.click(await screen.findByTitle('Remove download'));

    expect(removePlaylistDownload).toHaveBeenCalledWith('p1');
  });

  it('uploads and removes the cover', async () => {
    renderPage();
    expect(await screen.findByText('no cover')).toBeInTheDocument();

    await userEvent.click(screen.getByText('upload cover'));
    await waitFor(() => expect(subsonic.uploadPlaylistCover).toHaveBeenCalledWith('p1', expect.any(File)));

    await userEvent.click(screen.getByText('remove cover'));
    await waitFor(() => expect(subsonic.removePlaylistCover).toHaveBeenCalledWith('p1'));
  });

  it('knows when the playlist already has a cover', async () => {
    vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue(playlist({ coverArt: 'pl-p1' }));
    renderPage();
    expect(await screen.findByText('has cover')).toBeInTheDocument();
  });

  it('does not count the generated mosaic cover as an uploaded one (no "reset" offered)', async () => {
    vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue(playlist({ coverArt: 'plm-p1-1.2.3.4' }));
    renderPage();
    expect(await screen.findByText('no cover')).toBeInTheDocument();
  });

  it('shows the upload error message', async () => {
    vi.spyOn(subsonic, 'uploadPlaylistCover').mockRejectedValue(new Error('Image too large'));
    renderPage();

    await userEvent.click(await screen.findByText('upload cover'));

    expect(await screen.findByText('Image too large')).toBeInTheDocument();
  });
});

describe('PlaylistDetailPage — drag reorder', () => {
  const drag = (active: string, over?: string) =>
    act(() => dragEnd!({ active: { id: active }, over: over ? { id: over } : null } as unknown as DragEndEvent));
  const order = () => rows().map((r) => r!.match(/Song \w/)![0]);

  it('saves the new order and shows it at once, before the server answers', async () => {
    let finish!: () => void;
    vi.spyOn(subsonic, 'reorderPlaylistTracks').mockReturnValue(new Promise<void>((r) => { finish = r; }) as never);
    renderPage();
    await screen.findByRole('heading', { name: 'Road trip' });

    drag('a-0', 'c-2');

    await waitFor(() => expect(order()).toEqual(['Song b', 'Song c', 'Song a']));
    expect(subsonic.reorderPlaylistTracks).toHaveBeenCalledWith('p1', ['b', 'c', 'a']);
    finish();
  });

  it('puts the old order back when saving fails', async () => {
    vi.spyOn(subsonic, 'reorderPlaylistTracks').mockRejectedValue(new Error('500'));
    renderPage();
    await screen.findByRole('heading', { name: 'Road trip' });

    drag('c-2', 'a-0');

    await waitFor(() => expect(subsonic.reorderPlaylistTracks).toHaveBeenCalledWith('p1', ['c', 'a', 'b']));
    await waitFor(() => expect(order()).toEqual(['Song a', 'Song b', 'Song c']));
  });

  it('ignores a drop onto nothing or onto itself', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Road trip' });

    drag('a-0');
    drag('b-1', 'b-1');

    expect(subsonic.reorderPlaylistTracks).not.toHaveBeenCalled();
  });

  it('is not draggable in a date-sorted view (no DndContext)', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Road trip' });
    dragEnd = undefined;

    await userEvent.click(screen.getByRole('button', { name: 'Date added: oldest first' }));

    expect(dragEnd).toBeUndefined();
  });
});
