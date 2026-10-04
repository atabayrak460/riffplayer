// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PeoplePage } from './PeoplePage';
import { PersonPage } from './PersonPage';
import * as subsonic from '../api/subsonic';
import type { Person, Profile } from '../api/subsonic';
import type { Playlist, Song } from '../api/types';

vi.mock('../components/PlaylistCard', () => ({
  PlaylistCard: ({ pl }: { pl: Playlist }) => <div data-testid="playlist">{pl.name}</div>,
}));

const person = (over: Partial<Person> = {}): Person => ({
  id: 2, username: 'bob', displayName: 'Bobby', bio: null, hasAvatar: false, avatarVersion: null,
  isMe: false, nowListening: null, publicPlaylistCount: 0, ...over,
});

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/people/:id" element={<PersonPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(subsonic, 'getSocialStatus').mockResolvedValue(true);
});

describe('PeoplePage', () => {
  it('lists people with name, bio and public playlist count, linking to their profile', async () => {
    vi.spyOn(subsonic, 'getPeople').mockResolvedValue([
      person({ bio: 'Jazz on Sundays', publicPlaylistCount: 2 }),
      person({ id: 1, username: 'me', displayName: 'Me', isMe: true, publicPlaylistCount: 1 }),
    ]);
    renderAt('/people');

    expect(await screen.findByText('Bobby')).toBeInTheDocument();
    expect(screen.getByText('Jazz on Sundays')).toBeInTheDocument();
    expect(screen.getByText('2 public playlists')).toBeInTheDocument();
    expect(screen.getByText('1 public playlist')).toBeInTheDocument();
    expect(screen.getByText('you')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Bobby/ })).toHaveAttribute('href', '/people/2');
  });

  it('shows what someone is listening to only when the server sent it', async () => {
    const song = { id: 's', title: 'Karma Police', artist: 'Radiohead', startedAt: 1 } as Song & { startedAt: number };
    vi.spyOn(subsonic, 'getPeople').mockResolvedValue([
      person({ nowListening: song }),
      person({ id: 3, username: 'carol', displayName: 'Carol' }),
    ]);
    renderAt('/people');
    expect(await screen.findByText('Listening to Karma Police — Radiohead')).toBeInTheDocument();
    expect(screen.getAllByText(/Listening to/)).toHaveLength(1);
  });

  it('says so when the admin turned social features off, and fetches nothing', async () => {
    vi.spyOn(subsonic, 'getSocialStatus').mockResolvedValue(false);
    const getPeople = vi.spyOn(subsonic, 'getPeople').mockResolvedValue([]);
    renderAt('/people');
    expect(await screen.findByText(/turned off on this server/)).toBeInTheDocument();
    expect(getPeople).not.toHaveBeenCalled();
  });

  it('reports a failed load', async () => {
    vi.spyOn(subsonic, 'getPeople').mockRejectedValue(new Error('boom'));
    renderAt('/people');
    expect(await screen.findByText(/Couldn't load the people/)).toBeInTheDocument();
  });
});

describe('PersonPage', () => {
  const profile = (over: Partial<Profile> = {}): Profile => ({ ...person(), playlists: [], ...over });

  it('shows the profile and their public playlists', async () => {
    vi.spyOn(subsonic, 'getPerson').mockResolvedValue(
      profile({ bio: 'Hello there', playlists: [{ id: 'p1', name: 'Open mix' } as Playlist] }),
    );
    renderAt('/people/2');
    expect(await screen.findByText('Bobby')).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.getByText('Public playlists')).toBeInTheDocument();
    expect(screen.getByTestId('playlist')).toHaveTextContent('Open mix');
  });

  it('your own profile says "Your playlists"', async () => {
    vi.spyOn(subsonic, 'getPerson').mockResolvedValue(profile({ isMe: true }));
    renderAt('/people/1');
    expect(await screen.findByText('Your playlists')).toBeInTheDocument();
    expect(screen.getByText('You have no playlists yet.')).toBeInTheDocument();
  });

  it('explains an empty public list, and a person that does not exist', async () => {
    const get = vi.spyOn(subsonic, 'getPerson').mockResolvedValue(profile());
    const { unmount } = renderAt('/people/2');
    expect(await screen.findByText('No public playlists.')).toBeInTheDocument();
    unmount();

    get.mockRejectedValue(new Error('No such person'));
    renderAt('/people/999');
    expect(await screen.findByText(/Couldn't find that person/)).toBeInTheDocument();
  });
});
