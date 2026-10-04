// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlbumsPage } from './AlbumsPage';
import { MemoryRouter } from 'react-router-dom';
import { useUiStyleStore } from '../store/uiStyle';
import * as subsonic from '../api/subsonic';
import type { Album } from '../api/types';

vi.mock('../components/AlbumCard', () => ({
  AlbumCard: ({ album }: { album: Album }) => <div data-testid="album">{album.name}</div>,
}));

const albums = [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }] as Album[];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AlbumsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useUiStyleStore.setState({ style: 'default' });
  vi.restoreAllMocks();
  vi.spyOn(subsonic, 'getAlbumList').mockResolvedValue(albums);
});

describe('AlbumsPage', () => {
  it('loads 100 recently added albums by default', async () => {
    renderPage();

    expect(await screen.findAllByTestId('album')).toHaveLength(2);
    expect(subsonic.getAlbumList).toHaveBeenCalledWith('newest', { size: 100 });
    expect(screen.getByRole('combobox', { name: 'Sort albums' })).toHaveValue('newest');
  });

  it('offers every sort order', () => {
    renderPage();

    expect(within(screen.getByRole('combobox', { name: 'Sort albums' })).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Recently Added', 'Recently Played', 'Most Played', 'Starred', 'A–Z', 'By Artist', 'Random',
    ]);
  });

  it.each([
    ['Recently Played', 'recent'],
    ['Most Played', 'frequent'],
    ['Starred', 'starred'],
    ['A–Z', 'alphabeticalByName'],
    ['By Artist', 'alphabeticalByArtist'],
    ['Random', 'random'],
  ])('choosing "%s" requests type %s', async (label, type) => {
    renderPage();
    await screen.findAllByTestId('album');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort albums' }), label);

    await waitFor(() => expect(subsonic.getAlbumList).toHaveBeenCalledWith(type, { size: 100 }));
  });

  it('shows placeholders while loading', () => {
    vi.spyOn(subsonic, 'getAlbumList').mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();

    expect(container.querySelectorAll('.aspect-square.animate-pulse')).toHaveLength(24);
  });

  it('shows an error when loading fails', async () => {
    vi.spyOn(subsonic, 'getAlbumList').mockRejectedValue(new Error('500'));
    renderPage();

    expect(await screen.findByText('Failed to load albums.')).toBeInTheDocument();
    expect(screen.queryByText(/no albums found/i)).not.toBeInTheDocument();
  });

  it('suggests indexing when the library is empty', async () => {
    vi.spyOn(subsonic, 'getAlbumList').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no albums found/i)).toBeInTheDocument();
  });

  describe('view', () => {
    it('is a grid by default, and Cover Flow on request', async () => {
      renderPage();
      expect(await screen.findAllByTestId('album')).toHaveLength(2);
      expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');

      await userEvent.click(screen.getByRole('button', { name: 'Cover Flow' }));

      expect(screen.queryByTestId('album')).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: /Cover Flow/ })).toBeInTheDocument();
    });

    it('opens as Cover Flow in the iPod Classic style, and can still go back to the grid', async () => {
      useUiStyleStore.setState({ style: 'ipod' });
      renderPage();
      expect(await screen.findByRole('group', { name: /Cover Flow/ })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Grid' }));
      expect(await screen.findAllByTestId('album')).toHaveLength(2);
    });
  });

  describe('quality filter', () => {
    it('asks the server only for Hi-Res albums when chosen, and resets to all', async () => {
      renderPage();
      await screen.findAllByTestId('album');

      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by audio quality' }), 'hires');
      await waitFor(() => expect(subsonic.getAlbumList).toHaveBeenLastCalledWith('newest', { size: 100, quality: 'hires' }));

      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by audio quality' }), '');
      await waitFor(() => expect(subsonic.getAlbumList).toHaveBeenLastCalledWith('newest', { size: 100 }));
    });
  });
});
