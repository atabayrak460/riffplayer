// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddToPlaylistDialog } from './AddToPlaylistDialog';
import * as subsonic from '../api/subsonic';
import { useToastStore } from '../store/toast';
import type { Song } from '../api/types';

const EXISTING_PLAYLIST = { id: 'p-1', name: 'My Playlist', owner: 'admin', songCount: 0, duration: 0, public: false, created: '2024-01-01', changed: '2024-01-01' };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(subsonic, 'getPlaylists').mockResolvedValue([EXISTING_PLAYLIST]);
  vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue({ ...EXISTING_PLAYLIST, entry: [] });
  vi.spyOn(subsonic, 'addSongToPlaylist').mockResolvedValue(undefined);
  useToastStore.setState({ message: null });
  vi.spyOn(subsonic, 'createPlaylistWithName').mockResolvedValue({ ...EXISTING_PLAYLIST, id: 'p-2', name: 'New Playlist 2' });
});

function renderDialog(onClose = vi.fn()) {
  const qc = new QueryClient();
  return {
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <AddToPlaylistDialog songId="t-1" onClose={onClose} />
      </QueryClientProvider>,
    ),
  };
}

describe('AddToPlaylistDialog', () => {
  it('renders as an accessible dialog listing playlists', async () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Add to playlist' })).toBeInTheDocument();
    expect(await screen.findByText('My Playlist')).toBeInTheDocument();
  });

  it('offers "New playlist" even when no playlists exist yet', async () => {
    // Regression: this dialog used to only list *existing* playlists — with
    // none created yet, there was no way to add the song to a playlist at
    // all short of leaving the dialog and creating one blank elsewhere first.
    vi.spyOn(subsonic, 'getPlaylists').mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByText('No playlists yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new playlist/i })).toBeInTheDocument();
  });

  it('creating a new playlist asks for a name, then adds the song and closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByText('My Playlist');

    await user.click(screen.getByRole('button', { name: /new playlist/i }));
    expect(subsonic.createPlaylistWithName).not.toHaveBeenCalled();

    // A blank name can't be submitted.
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('Playlist name'), '   ');
    expect(create).toBeDisabled();

    await user.type(screen.getByLabelText('Playlist name'), ' Road trip{Enter}');

    await waitFor(() => expect(subsonic.createPlaylistWithName).toHaveBeenCalledWith('Road trip'));
    await waitFor(() => expect(subsonic.addSongToPlaylist).toHaveBeenCalledWith('p-2', 't-1'));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('going back from the name prompt creates nothing', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByText('My Playlist');

    await user.click(screen.getByRole('button', { name: /new playlist/i }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(subsonic.createPlaylistWithName).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('My Playlist')).toBeInTheDocument();
  });

  it('adds the song to an existing playlist that does not contain it yet', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(await screen.findByText('My Playlist'));

    await waitFor(() => expect(subsonic.addSongToPlaylist).toHaveBeenCalledWith('p-1', 't-1'));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(useToastStore.getState().message).toBeNull();
  });

  it('does not add a song that is already in the playlist and shows a toast instead', async () => {
    vi.spyOn(subsonic, 'getPlaylist').mockResolvedValue({
      ...EXISTING_PLAYLIST,
      entry: [{ id: 't-1' } as Song],
    });
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(await screen.findByText('My Playlist'));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(subsonic.addSongToPlaylist).not.toHaveBeenCalled();
    expect(useToastStore.getState().message).toBe('Already in "My Playlist"');
  });
});
