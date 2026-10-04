// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecommendationsPage } from './RecommendationsPage';
import * as subsonic from '../api/subsonic';
import type { Song } from '../api/types';

vi.mock('../components/StockCovers', () => ({ DiscoverCover: () => null }));
vi.mock('../components/SongRow', () => ({
  SongRow: ({ song, index }: { song: Song; index: number }) => (
    <div data-testid="song">{`${index}. ${song.title}`}</div>
  ),
}));
vi.mock('../components/SystemViewHeader', () => ({
  SystemViewHeader: ({ meta, defaultDescription }: { meta?: React.ReactNode; defaultDescription: string }) => (
    <header>
      <p data-testid="description">{defaultDescription}</p>
      {meta && <p data-testid="meta">{meta}</p>}
    </header>
  ),
}));

const songs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Song ${i}` }) as Song);

// The page opens on the Weekly discovery tab; these tests are about the library-based tabs, so
// open "Similar to your taste" first (the weekly tab has its own tests).
function renderPage(openSimilar = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <RecommendationsPage />
    </QueryClientProvider>,
  );
  if (openSimilar) fireEvent.click(screen.getByRole('button', { name: 'Similar to your taste' }));
  return result;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(subsonic, 'getRecommendations').mockResolvedValue({ songs: songs(3), source: 'lastfm' });
});

describe('RecommendationsPage', () => {
  it('starts on "Similar to your taste" and shows the suggestions', async () => {
    renderPage();

    expect(await screen.findAllByTestId('song')).toHaveLength(3);
    expect(subsonic.getRecommendations).toHaveBeenCalledWith('similar');
    expect(screen.getByRole('button', { name: 'Similar to your taste' })).toHaveClass('text-brand');
  });

  it('switching to "Picked for you" loads the other list', async () => {
    renderPage();
    await screen.findAllByTestId('song');

    await userEvent.click(screen.getByRole('button', { name: 'Picked for you' }));

    await waitFor(() => expect(subsonic.getRecommendations).toHaveBeenCalledWith('discover'));
    expect(screen.getByRole('button', { name: 'Picked for you' })).toHaveClass('text-brand');
  });

  it('↻ Refresh refetches the current tab', async () => {
    renderPage();
    await screen.findAllByTestId('song');

    await userEvent.click(screen.getByTitle('Refresh suggestions'));

    await waitFor(() => expect(subsonic.getRecommendations).toHaveBeenCalledTimes(2));
  });

  it('shows placeholders while loading', () => {
    vi.spyOn(subsonic, 'getRecommendations').mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(10);
  });

  it('attributes the source in the description: Last.fm vs local AI', async () => {
    const { unmount } = renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('description')).toHaveTextContent('Suggested by Last.fm · from your library only'),
    );
    unmount();

    vi.spyOn(subsonic, 'getRecommendations').mockResolvedValue({ songs: songs(1), source: 'ollama' });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('description')).toHaveTextContent('Suggested by local AI (Ollama) · from your library only'),
    );
  });

  it('uses a neutral description before any source is known', () => {
    vi.spyOn(subsonic, 'getRecommendations').mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByTestId('description')).toHaveTextContent('Personalized suggestions from your own library');
  });

  it('pluralises the suggestion count', async () => {
    renderPage();
    expect(await screen.findByTestId('meta')).toHaveTextContent('3 suggestions');
  });

  it('says "1 suggestion" for a single result', async () => {
    vi.spyOn(subsonic, 'getRecommendations').mockResolvedValue({ songs: songs(1), source: 'lastfm' });
    renderPage();

    expect(await screen.findByTestId('meta')).toHaveTextContent(/^1 suggestion$/);
  });

  it('shows the server\'s error without the "Error: " prefix, plus setup guidance', async () => {
    vi.spyOn(subsonic, 'getRecommendations').mockRejectedValue(new Error('Last.fm API key not configured'));
    renderPage();

    expect(await screen.findByText('Last.fm API key not configured')).toBeInTheDocument();
    expect(screen.getByText(/configure a Last\.fm/)).toBeInTheDocument();
    expect(screen.queryAllByTestId('song')).toHaveLength(0);
  });

  it('explains an empty result instead of showing an error', async () => {
    vi.spyOn(subsonic, 'getRecommendations').mockResolvedValue({ songs: [], source: 'lastfm' });
    renderPage();

    expect(await screen.findByText(/no matching tracks found in your library/i)).toBeInTheDocument();
    expect(screen.queryByText(/configure a Last\.fm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/never provides links/i)).not.toBeInTheDocument();
  });

  it('keeps the "library only, no sources" notice under real results', async () => {
    renderPage();
    expect(await screen.findByText(/never provides links or sources to acquire music/i)).toBeInTheDocument();
  });
});
