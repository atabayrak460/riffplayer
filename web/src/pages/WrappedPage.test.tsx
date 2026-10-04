// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WrappedPage } from './WrappedPage';
import * as subsonic from '../api/subsonic';
import type { WrappedStats } from '../api/subsonic';

vi.mock('../components/CoverArt', () => ({ CoverArt: () => null }));
vi.mock('../components/StockCovers', () => ({ WrappedCover: () => null }));
vi.mock('../components/SystemViewHeader', () => ({
  SystemViewHeader: ({ meta, defaultDescription }: { meta: React.ReactNode; defaultDescription: string }) => (
    <header>
      <div data-testid="year-picker">{meta}</div>
      <p data-testid="default-description">{defaultDescription}</p>
    </header>
  ),
}));

const currentYear = new Date().getFullYear();

const track = (n: number, playCount: number) => ({
  id: `t${n}`, title: `Track ${n}`, artist: `Artist ${n}`, artistId: `ar${n}`,
  album: `Album ${n}`, albumId: `al${n}`, coverArt: `c${n}`, playCount,
});

function stats(extra: Partial<WrappedStats> = {}): WrappedStats {
  return {
    year: currentYear,
    totalPlays: 1234,
    totalMinutes: 5430,
    topTracks: [track(1, 50), track(2, 30), track(3, 10)],
    topArtists: Array.from({ length: 7 }, (_, i) => ({
      id: `ar${i + 1}`, name: `Artist ${i + 1}`, coverArt: null, playCount: 70 - i,
    })),
    topAlbums: [],
    importedPlays: 0,
    byMonth: [{ month: 1, plays: 10 }, { month: 6, plays: 40 }],
    ...extra,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WrappedPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(subsonic, 'getWrapped').mockResolvedValue(stats());
  vi.spyOn(subsonic, 'generateWrappedSummary').mockResolvedValue('You loved jazz this year.');
});

describe('WrappedPage — year and states', () => {
  it('offers the current year and the four before it, defaulting to the current year', async () => {
    renderPage();
    const picker = within(screen.getByTestId('year-picker')).getByRole('combobox');

    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(
      [0, 1, 2, 3, 4].map((i) => String(currentYear - i)),
    );
    expect(picker).toHaveValue(String(currentYear));
    await waitFor(() => expect(subsonic.getWrapped).toHaveBeenCalledWith(currentYear));
  });

  it('refetches for the chosen year', async () => {
    renderPage();
    await screen.findByText('Total plays');

    await userEvent.selectOptions(
      within(screen.getByTestId('year-picker')).getByRole('combobox'),
      String(currentYear - 2),
    );

    await waitFor(() => expect(subsonic.getWrapped).toHaveBeenCalledWith(currentYear - 2));
  });

  it('shows placeholders while loading', () => {
    vi.spyOn(subsonic, 'getWrapped').mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
  });

  it('says there is no history when the request fails', async () => {
    vi.spyOn(subsonic, 'getWrapped').mockRejectedValue(new Error('404'));
    renderPage();

    expect(await screen.findByText(`No play history found for ${currentYear}.`)).toBeInTheDocument();
  });

  it('says nothing was played when the year has zero plays, and shows no stats', async () => {
    vi.spyOn(subsonic, 'getWrapped').mockResolvedValue(stats({ totalPlays: 0, topTracks: [], topArtists: [], byMonth: [] }));
    renderPage();

    expect(await screen.findByText(`No plays recorded for ${currentYear} yet.`)).toBeInTheDocument();
    expect(screen.queryByText('Total plays')).not.toBeInTheDocument();
    expect(screen.getByTestId('default-description')).toHaveTextContent('Your year in music');
  });

  it('uses the play count in the default description once there is one', async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('default-description')).toHaveTextContent(
        `${(1234).toLocaleString()} plays across ${currentYear}`,
      ),
    );
  });
});

describe('WrappedPage — stats', () => {
  it('shows total plays and listening time in hours (rounded) with the exact minutes', async () => {
    renderPage();

    expect(await screen.findByText((1234).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText('91 hrs')).toBeInTheDocument(); // 5430 min / 60 = 90.5 → 91
    expect(screen.getByText(`${(5430).toLocaleString()} min`)).toBeInTheDocument();
  });

  it('highlights the top track with a link to its album', async () => {
    renderPage();

    const heading = await screen.findByText('Top track');
    const link = heading.parentElement!.querySelector('a')!;
    expect(link).toHaveAttribute('href', '/albums/al1');
    expect(within(link).getByText('Track 1')).toBeInTheDocument();
    expect(within(link).getByText('50 plays')).toBeInTheDocument();
  });

  it('lists only the top five artists, ranked and linked', async () => {
    renderPage();
    const heading = await screen.findByText('Top artists');
    const links = Array.from(heading.parentElement!.querySelectorAll('a'));

    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAttribute('href', '/artists/ar1');
    expect(links[0]).toHaveTextContent('1Artist 170 plays');
    expect(links[4]).toHaveTextContent('5Artist 566 plays');
  });

  it('hides "Top artists" when there are none', async () => {
    vi.spyOn(subsonic, 'getWrapped').mockResolvedValue(stats({ topArtists: [] }));
    renderPage();
    await screen.findByText('Total plays');

    expect(screen.queryByText('Top artists')).not.toBeInTheDocument();
  });

  it('draws a bar for every month, scaled to the busiest one', async () => {
    renderPage();
    await screen.findByText('Plays by month');

    const jun = screen.getByTitle('Jun: 40 plays');
    const jan = screen.getByTitle('Jan: 10 plays');
    const mar = screen.getByTitle('Mar: 0 plays');
    expect(jun).toHaveStyle({ height: '100%' });
    expect(jan).toHaveStyle({ height: '25%' });
    expect(mar).toHaveStyle({ height: '0%' });
    expect(screen.getAllByTitle(/: \d+ plays$/)).toHaveLength(12);
  });

  it('gives a tiny non-zero month a visible minimum height', async () => {
    vi.spyOn(subsonic, 'getWrapped').mockResolvedValue(
      stats({ byMonth: [{ month: 1, plays: 1 }, { month: 2, plays: 1000 }] }),
    );
    renderPage();
    await screen.findByText('Plays by month');

    expect(screen.getByTitle('Jan: 1 plays')).toHaveStyle({ minHeight: '4px' });
    expect(screen.getByTitle('Mar: 0 plays')).toHaveStyle({ minHeight: '0px' });
  });

  it('hides the monthly chart when there is no monthly data', async () => {
    vi.spyOn(subsonic, 'getWrapped').mockResolvedValue(stats({ byMonth: [] }));
    renderPage();
    await screen.findByText('Total plays');

    expect(screen.queryByText('Plays by month')).not.toBeInTheDocument();
  });

  it('lists all top tracks only when there is more than one', async () => {
    renderPage();
    const heading = await screen.findByText('All top tracks');
    expect(heading.parentElement!.querySelectorAll('a')).toHaveLength(3);
  });

  it('skips "All top tracks" for a single track, and the top-track card for none', async () => {
    vi.spyOn(subsonic, 'getWrapped').mockResolvedValue(stats({ topTracks: [track(1, 5)] }));
    const { unmount } = renderPage();
    await screen.findByText('Top track');
    expect(screen.queryByText('All top tracks')).not.toBeInTheDocument();
    unmount();

    vi.spyOn(subsonic, 'getWrapped').mockResolvedValue(stats({ topTracks: [] }));
    renderPage();
    await screen.findByText('Total plays');
    expect(screen.queryByText('Top track')).not.toBeInTheDocument();
  });
});

describe('WrappedPage — AI summary', () => {
  it('generates the summary for the selected year and shows it in place of the button', async () => {
    renderPage();
    await userEvent.selectOptions(
      within(screen.getByTestId('year-picker')).getByRole('combobox'),
      String(currentYear - 1),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Generate with Ollama' }));

    expect(await screen.findByText('You loved jazz this year.')).toBeInTheDocument();
    expect(subsonic.generateWrappedSummary).toHaveBeenCalledWith(currentYear - 1);
    expect(screen.queryByRole('button', { name: 'Generate with Ollama' })).not.toBeInTheDocument();
  });

  it('disables the button and says Generating… while waiting', async () => {
    vi.spyOn(subsonic, 'generateWrappedSummary').mockReturnValue(new Promise(() => {}));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Generate with Ollama' }));

    expect(await screen.findByRole('button', { name: 'Generating…' })).toBeDisabled();
  });

  it('shows the failure without the "Error: " prefix and lets the user retry', async () => {
    vi.spyOn(subsonic, 'generateWrappedSummary').mockRejectedValue(new Error('Ollama is not configured'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Generate with Ollama' }));

    expect(await screen.findByText('Ollama is not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate with Ollama' })).toBeEnabled();
  });
});

describe('WrappedPage — imported history', () => {
  it('says how many plays were imported, and does not link songs that are not in the library', async () => {
    vi.spyOn(subsonic, 'getWrapped').mockResolvedValue(stats({
      importedPlays: 900,
      topTracks: [
        { ...track(1, 50), id: '', albumId: '', coverArt: null, external: true },
        track(2, 30),
      ],
      topArtists: [{ id: '', name: 'Far Band', coverArt: null, playCount: 40, external: true }],
    }));
    renderPage();

    expect(await screen.findByText('Includes 900 plays imported from other services.')).toBeInTheDocument();
    expect(screen.getByText('Far Band').closest('a')).toBeNull();
    expect(screen.getAllByText('Track 1')[0].closest('a')).toBeNull();
    expect(screen.getAllByText('Track 2')[0].closest('a')).toHaveAttribute('href', '/albums/al2');
  });
});

