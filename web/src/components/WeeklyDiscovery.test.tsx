// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WeeklyDiscovery } from './WeeklyDiscovery';
import * as subsonic from '../api/subsonic';
import { RecommendationsPage } from '../pages/RecommendationsPage';

vi.mock('./StockCovers', () => ({ DiscoverCover: () => null }));
vi.mock('./SystemViewHeader', () => ({ SystemViewHeader: () => <header /> }));

const ok = (items: subsonic.DiscoveryItem[]) => ({ status: 'ok' as const, week: '2026-10-05', items });

function renderIt(node = <WeeklyDiscovery />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => vi.restoreAllMocks());

describe('WeeklyDiscovery', () => {
  it('lists the suggestions with a track to try and why', async () => {
    vi.spyOn(subsonic, 'getWeeklyDiscovery').mockResolvedValue(
      ok([{ artist: 'Brand New Band', track: 'Hit One', because: ['Radiohead', 'Muse'] }, { artist: 'Another Act', because: ['Muse'] }]),
    );
    renderIt();

    expect(await screen.findByText('Brand New Band')).toBeInTheDocument();
    expect(screen.getByText('Try: Hit One')).toBeInTheDocument();
    expect(screen.getByText('Because you listen to Radiohead, Muse')).toBeInTheDocument();
    expect(screen.getByText('Another Act')).toBeInTheDocument();
    expect(screen.getByText(/week of .*\b5\b/)).toBeInTheDocument(); // "5 October" or "October 5", by locale
  });

  it('only ever shows names — no links, no play buttons', async () => {
    vi.spyOn(subsonic, 'getWeeklyDiscovery').mockResolvedValue(ok([{ artist: 'Brand New Band', track: 'Hit One', because: ['A'] }]));
    renderIt();
    await screen.findByText('Brand New Band');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /play|download/i })).not.toBeInTheDocument();
    expect(screen.getByText(/never provides links or\s+sources/)).toBeInTheDocument();
  });

  it('"New picks" asks the server to build the list again and shows the result', async () => {
    vi.spyOn(subsonic, 'getWeeklyDiscovery').mockResolvedValue(ok([{ artist: 'First', because: ['A'] }]));
    const refresh = vi.spyOn(subsonic, 'refreshWeeklyDiscovery').mockResolvedValue(ok([{ artist: 'Second', because: ['A'] }]));
    renderIt();
    await screen.findByText('First');

    await userEvent.click(screen.getByRole('button', { name: /New picks/ }));

    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(screen.queryByText('First')).not.toBeInTheDocument();
  });

  it('explains a missing Last.fm key and a missing listening history', async () => {
    const get = vi.spyOn(subsonic, 'getWeeklyDiscovery').mockResolvedValue({ status: 'not_configured' });
    const { unmount } = renderIt();
    expect(await screen.findByText(/needs a Last.fm API key/)).toBeInTheDocument();
    unmount();

    get.mockResolvedValue({ status: 'no_history' });
    renderIt();
    expect(await screen.findByText(/Listen to some music first/)).toBeInTheDocument();
  });

  it('copes with an empty list and with a failed load', async () => {
    const get = vi.spyOn(subsonic, 'getWeeklyDiscovery').mockResolvedValue(ok([]));
    const { unmount } = renderIt();
    expect(await screen.findByText(/Nothing new to suggest/)).toBeInTheDocument();
    unmount();

    get.mockRejectedValue(new Error('boom'));
    renderIt();
    expect(await screen.findByText(/Couldn't load this week's discoveries/)).toBeInTheDocument();
  });
});

describe('Discover page', () => {
  it('opens on the weekly tab and can switch to the library-based ones', async () => {
    vi.spyOn(subsonic, 'getWeeklyDiscovery').mockResolvedValue(ok([{ artist: 'Brand New Band', because: ['A'] }]));
    const recs = vi.spyOn(subsonic, 'getRecommendations').mockResolvedValue({ songs: [], source: 'lastfm' });
    renderIt(<RecommendationsPage />);

    expect(await screen.findByText('Brand New Band')).toBeInTheDocument();
    expect(recs).not.toHaveBeenCalled(); // nothing is fetched for tabs that aren't open

    await userEvent.click(screen.getByRole('button', { name: 'Picked for you' }));
    await waitFor(() => expect(recs).toHaveBeenCalledWith('discover'));
  });
});
