// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HeroSection } from './HeroSection';
import { AlbumTracksSection } from './AlbumTracksSection';
import { ArtistTracksSection } from './ArtistTracksSection';
import * as subsonic from '../../api/subsonic';
import type { Album, Artist, Song } from '../../api/types';

vi.mock('../CoverArt', () => ({
  CoverArt: ({ id, alt }: { id?: string; alt?: string }) => <i data-testid="cover" data-id={id} data-alt={alt} />,
}));
vi.mock('../SongRow', () => ({
  SongRow: (p: { song: Song; index: number; queue: Song[]; condensed?: boolean; condensedSubtitle?: string }) => (
    <div data-testid="row" data-queue={p.queue.map((s) => s.id).join(',')}>
      {`${p.index}. ${p.song.title}${p.condensedSubtitle ? ` (${p.condensedSubtitle})` : ''}${p.condensed ? ' [condensed]' : ''}`}
    </div>
  ),
}));

const song = (id: string, extra: Partial<Song> = {}) =>
  ({ id, title: `Song ${id}`, album: 'Album X', albumId: 'al1', artist: 'The Band', artistId: 'ar1', ...extra }) as Song;

// "renders nothing" must be asserted AFTER the fetched data had a chance to arrive, otherwise the
// check passes vacuously on the initial empty render.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function renderWith(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('HeroSection', () => {
  const current = song('s1', { coverArt: 'cv1', title: 'Karma Police', artist: 'Radiohead', album: 'OK Computer', albumId: 'al9', artistId: 'ar7' });

  beforeEach(() => {
    vi.spyOn(subsonic, 'getArtist').mockResolvedValue({ id: 'ar7', name: 'Radiohead', album: [] } as unknown as Artist & { album: Album[] });
  });

  it('shows the cover, title, and artist/album links', () => {
    renderWith(<HeroSection song={current} />);

    expect(screen.getByText('Karma Police')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Radiohead' })).toHaveAttribute('href', '/artists/ar7');
    expect(screen.getByRole('link', { name: 'OK Computer' })).toHaveAttribute('href', '/albums/al9');
    const cover = screen.getAllByTestId('cover')[0];
    expect(cover.dataset.id).toBe('cv1');
    expect(cover.dataset.alt).toBe('OK Computer');
  });

  it('looks up the artist by the song\'s artist id', async () => {
    renderWith(<HeroSection song={current} />);

    await waitFor(() => expect(subsonic.getArtist).toHaveBeenCalledWith('ar7'));
  });

  it('shows the artist\'s photo as a badge linking to the artist when they have one', async () => {
    vi.spyOn(subsonic, 'getArtist').mockResolvedValue({ id: 'ar7', name: 'Radiohead', coverArt: 'ar-ar7', album: [] } as unknown as Artist & { album: Album[] });
    renderWith(<HeroSection song={current} />);

    const badge = await screen.findByTitle('Radiohead');
    expect(badge).toHaveAttribute('href', '/artists/ar7');
    expect(within(badge).getByTestId('cover').dataset.id).toBe('ar-ar7');
  });

  it('has no artist badge without an artist photo', async () => {
    renderWith(<HeroSection song={current} />);
    await waitFor(() => expect(subsonic.getArtist).toHaveBeenCalled());

    expect(screen.queryByTitle('Radiohead')).not.toBeInTheDocument();
  });

  it('opens the cover large from the enlarge button and closes it again', () => {
    renderWith(<HeroSection song={current} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enlarge cover' }));
    const dialog = screen.getByRole('dialog', { name: 'OK Computer cover' });
    expect(within(dialog).getByTestId('cover').dataset.id).toBe('cv1');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the enlarged cover with Escape', () => {
    renderWith(<HeroSection song={current} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge cover' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no enlarge button for a song without cover art', () => {
    renderWith(<HeroSection song={{ ...current, coverArt: undefined }} />);
    expect(screen.queryByRole('button', { name: 'Enlarge cover' })).not.toBeInTheDocument();
  });
});

describe('AlbumTracksSection', () => {
  const tracks = [song('a'), song('b'), song('c')];

  beforeEach(() => {
    vi.spyOn(subsonic, 'getAlbum').mockResolvedValue({ id: 'al1', song: tracks } as never);
  });

  it('lists the album\'s other tracks, numbered by album position, queued as the whole album', async () => {
    renderWith(<AlbumTracksSection song={tracks[1]} />);

    expect(await screen.findByText('More from this album')).toBeInTheDocument();
    const rows = screen.getAllByTestId('row');
    expect(rows.map((r) => r.textContent)).toEqual(['1. Song a [condensed]', '3. Song c [condensed]']);
    expect(rows[0].dataset.queue).toBe('a,b,c');
    expect(subsonic.getAlbum).toHaveBeenCalledWith('al1');
  });

  it('renders nothing when the playing song is the only track', async () => {
    vi.spyOn(subsonic, 'getAlbum').mockResolvedValue({ id: 'al1', song: [tracks[0]] } as never);
    const { container } = renderWith(<AlbumTracksSection song={tracks[0]} />);

    await waitFor(() => expect(subsonic.getAlbum).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an album without a track list', async () => {
    vi.spyOn(subsonic, 'getAlbum').mockResolvedValue({ id: 'al1' } as never);
    const { container } = renderWith(<AlbumTracksSection song={tracks[0]} />);

    await waitFor(() => expect(subsonic.getAlbum).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ArtistTracksSection', () => {
  const albumSongs = (n: number) =>
    Array.from({ length: n }, (_, i) => song(`t${String(i).padStart(2, '0')}`, { title: `Track ${String(i).padStart(2, '0')}`, album: 'Album X' }));

  function mockArtist(songs: Song[]) {
    vi.spyOn(subsonic, 'getArtist').mockResolvedValue({ id: 'ar1', name: 'The Band', album: [{ id: 'al1', name: 'Album X' }] } as unknown as Artist & { album: Album[] });
    vi.spyOn(subsonic, 'getAlbum').mockResolvedValue({ id: 'al1', song: songs } as never);
  }

  it('lists the artist\'s other songs with their album as subtitle, excluding the playing one', async () => {
    const all = albumSongs(3);
    mockArtist(all);
    renderWith(<ArtistTracksSection song={all[1]} />);

    expect(await screen.findByText('More from this artist')).toBeInTheDocument();
    expect(screen.getAllByTestId('row').map((r) => r.textContent)).toEqual([
      '1. Track 00 (Album X) [condensed]',
      '2. Track 02 (Album X) [condensed]',
    ]);
  });

  it('queues only the other songs, so playback never repeats the current one', async () => {
    const all = albumSongs(3);
    mockArtist(all);
    renderWith(<ArtistTracksSection song={all[1]} />);

    await screen.findByText('More from this artist');
    expect(screen.getAllByTestId('row')[0].dataset.queue).toBe('t00,t02');
  });

  it('caps the list at 8 and links "See all" to the artist\'s Songs tab only when there are more', async () => {
    const all = albumSongs(12);
    mockArtist(all);
    renderWith(<ArtistTracksSection song={all[0]} />);

    await screen.findByText('More from this artist');
    expect(screen.getAllByTestId('row')).toHaveLength(8);
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/artists/ar1?tab=songs');
  });

  it('shows no "See all" link when everything fits', async () => {
    const all = albumSongs(9); // 8 others besides the playing one
    mockArtist(all);
    renderWith(<ArtistTracksSection song={all[0]} />);

    await screen.findByText('More from this artist');
    expect(screen.getAllByTestId('row')).toHaveLength(8);
    expect(screen.queryByRole('link', { name: 'See all' })).not.toBeInTheDocument();
  });

  it('renders nothing when the artist has no other songs', async () => {
    const all = albumSongs(1);
    mockArtist(all);
    const { container } = renderWith(<ArtistTracksSection song={all[0]} />);

    await waitFor(() => expect(subsonic.getAlbum).toHaveBeenCalled());
    await settle();
    expect(container).toBeEmptyDOMElement();
  });
});
