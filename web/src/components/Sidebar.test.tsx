// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '../store/auth';
import * as subsonic from '../api/subsonic';
import type { Playlist } from '../api/types';

vi.mock('./CoverArt', () => ({ CoverArt: () => null }));

const pl = (id: string, name: string): Playlist => ({
  id, name, owner: 'admin', songCount: 1, duration: 60, public: false, created: '', changed: '',
});

const logout = vi.fn();

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderSidebar(initial = '/albums') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Sidebar />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Labels of the library rows, in the order they are shown. */
function libraryOrder() {
  const nav = screen.getAllByRole('navigation');
  return nav
    .flatMap((n) => within(n).queryAllByRole('link'))
    .map((a) => a.textContent)
    .filter((t): t is string => !!t);
}

beforeEach(() => {
  vi.restoreAllMocks();
  logout.mockClear();
  useAuthStore.setState({ user: { id: 1, username: 'u', role: 'user' }, logout });
  vi.spyOn(subsonic, 'getPlaylists').mockResolvedValue([]);
  vi.spyOn(subsonic, 'getLibrarySidebarState').mockResolvedValue([]);
  vi.spyOn(subsonic, 'adminGetSettings').mockResolvedValue({});
  vi.spyOn(subsonic, 'getSocialStatus').mockResolvedValue(false);
  vi.spyOn(subsonic, 'createPlaylistWithName').mockResolvedValue(pl('9', 'x'));
  vi.spyOn(subsonic, 'pinLibraryItem').mockResolvedValue(undefined);
  vi.spyOn(subsonic, 'unpinLibraryItem').mockResolvedValue(undefined);
  vi.spyOn(subsonic, 'recordLibraryInteraction').mockResolvedValue(undefined);
});

describe('Sidebar navigation', () => {
  it('has the fixed top navigation', () => {
    renderSidebar();

    for (const [label, href] of [
      ['Home', '/home'], ['Albums', '/albums'], ['Artists', '/artists'],
      ['Search', '/search'], ['Queue', '/queue'], ['Settings', '/settings'],
    ]) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('marks the current page as active', () => {
    renderSidebar('/artists');

    expect(screen.getByRole('link', { name: 'Artists' })).toHaveClass('bg-zinc-800');
    expect(screen.getByRole('link', { name: 'Albums' })).not.toHaveClass('bg-zinc-800');
  });

  it('Sign out calls logout', async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar library list', () => {
  it('lists the system views in their fixed order, then playlists', async () => {
    vi.spyOn(subsonic, 'getPlaylists').mockResolvedValue([pl('1', 'Chill'), pl('2', 'Workout')]);
    renderSidebar();
    await screen.findByText('Chill');

    const order = libraryOrder();
    const lib = order.slice(order.indexOf('All Songs'));
    expect(lib).toEqual([
      'All Songs', 'Favourites', 'Recently Played', 'Most Played', 'Downloaded',
      'Discover', 'Wrapped', 'Chill', 'Workout',
    ]);
  });

  it('puts recently-opened items first and pinned items in their own block above', async () => {
    vi.spyOn(subsonic, 'getPlaylists').mockResolvedValue([pl('1', 'Chill'), pl('2', 'Workout')]);
    vi.spyOn(subsonic, 'getLibrarySidebarState').mockResolvedValue([
      { itemType: 'playlist', itemKey: '2', pinnedAt: null, lastInteractedAt: '2024-05-02T00:00:00Z' },
      { itemType: 'system', itemKey: 'wrapped', pinnedAt: '2024-05-01T00:00:00Z', lastInteractedAt: '2024-05-01T00:00:00Z' },
    ] as never);
    renderSidebar();
    await screen.findByText('Chill');

    await waitFor(() => {
      const order = libraryOrder();
      expect(order.slice(order.indexOf('Wrapped'), order.indexOf('Wrapped') + 3)).toEqual(['Wrapped', 'Workout', 'All Songs']);
    });
  });

  it('links playlists to their page', async () => {
    vi.spyOn(subsonic, 'getPlaylists').mockResolvedValue([pl('7', 'Chill')]);
    renderSidebar();

    expect(await screen.findByRole('link', { name: 'Chill' })).toHaveAttribute('href', '/playlists/7');
  });

  it('opening an item records the interaction and refreshes the order', async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole('link', { name: 'Favourites' }));

    expect(subsonic.recordLibraryInteraction).toHaveBeenCalledWith('system', 'favorites');
    expect(screen.getByTestId('where')).toHaveTextContent('/favorites');
    await waitFor(() => expect(subsonic.getLibrarySidebarState).toHaveBeenCalledTimes(2));
  });

  it('still navigates when recording the interaction fails', async () => {
    vi.spyOn(subsonic, 'recordLibraryInteraction').mockRejectedValue(new Error('offline'));
    renderSidebar();

    await userEvent.click(screen.getByRole('link', { name: 'Wrapped' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/wrapped');
  });

  it('right-click → Pin pins an unpinned item', async () => {
    renderSidebar();

    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('link', { name: 'Discover' }) });
    await userEvent.click(await screen.findByText('Pin'));

    expect(subsonic.pinLibraryItem).toHaveBeenCalledWith('system', 'discover');
  });

  it('right-click → Unpin unpins a pinned item', async () => {
    vi.spyOn(subsonic, 'getLibrarySidebarState').mockResolvedValue([
      { itemType: 'system', itemKey: 'discover', pinnedAt: '2024-05-01T00:00:00Z', lastInteractedAt: '2024-05-01T00:00:00Z' },
    ] as never);
    renderSidebar();
    await screen.findByRole('link', { name: 'Discover' });
    // once the state arrives the row moves into the pinned block (a remount), so re-query it
    await waitFor(() => expect(libraryOrder().indexOf('Discover')).toBeLessThan(libraryOrder().indexOf('All Songs')));

    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('link', { name: 'Discover' }) });
    await userEvent.click(await screen.findByText('Unpin'));

    expect(subsonic.unpinLibraryItem).toHaveBeenCalledWith('system', 'discover');
  });
});

describe('Sidebar create playlist', () => {
  it('names the first playlist "New Playlist" and opens it', async () => {
    vi.spyOn(subsonic, 'createPlaylistWithName').mockResolvedValue(pl('42', 'New Playlist'));
    renderSidebar();

    await userEvent.click(screen.getByTitle('Create playlist'));

    expect(subsonic.createPlaylistWithName).toHaveBeenCalledWith('New Playlist');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/playlists/42'));
    await waitFor(() => expect(subsonic.getPlaylists).toHaveBeenCalledTimes(2));
  });

  it('numbers later playlists after the existing count', async () => {
    vi.spyOn(subsonic, 'getPlaylists').mockResolvedValue([pl('1', 'A'), pl('2', 'B')]);
    renderSidebar();
    await screen.findByText('A');

    await userEvent.click(screen.getByTitle('Create playlist'));

    expect(subsonic.createPlaylistWithName).toHaveBeenCalledWith('New Playlist 3');
  });
});

describe('Sidebar donation link', () => {
  it('is shown to a regular user without asking for admin settings', () => {
    renderSidebar();

    expect(screen.getByRole('link', { name: /support riffplayer/i })).toBeInTheDocument();
    expect(subsonic.adminGetSettings).not.toHaveBeenCalled();
  });

  it('is hidden when an admin turned the prompt off', async () => {
    useAuthStore.setState({ user: { id: 1, username: 'a', role: 'admin' } });
    vi.spyOn(subsonic, 'adminGetSettings').mockResolvedValue({ donation_prompt_enabled: 'false' });
    renderSidebar();

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /support riffplayer/i })).not.toBeInTheDocument(),
    );
  });

  it('stays visible for an admin while the setting is unset or on', async () => {
    useAuthStore.setState({ user: { id: 1, username: 'a', role: 'admin' } });
    vi.spyOn(subsonic, 'adminGetSettings').mockResolvedValue({ donation_prompt_enabled: 'true' });
    renderSidebar();
    await waitFor(() => expect(subsonic.adminGetSettings).toHaveBeenCalled());

    expect(screen.getByRole('link', { name: /support riffplayer/i })).toBeInTheDocument();
  });
});

describe('People entry', () => {
  it('appears only while social features are on', async () => {
    const { unmount } = renderSidebar();
    await waitFor(() => expect(subsonic.getSocialStatus).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'People' })).not.toBeInTheDocument();
    unmount();

    vi.spyOn(subsonic, 'getSocialStatus').mockResolvedValue(true);
    renderSidebar();
    expect(await screen.findByRole('link', { name: 'People' })).toHaveAttribute('href', '/people');
  });
});
