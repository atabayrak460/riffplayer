// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AllSongsPage } from './AllSongsPage';
import * as subsonic from '../api/subsonic';
import type { Song } from '../api/types';

function song(id: string): Song {
  return {
    id, title: `Song ${id}`, album: 'Album', albumId: 'al-1', artist: 'Artist', artistId: 'ar-1',
    created: '2024-01-01', isVideo: false, type: 'music', suffix: 'mp3',
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <AllSongsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

// react-virtual measures both the scroll container and each row via plain
// offsetHeight (see @tanstack/virtual-core's getRect/measureElement), not
// getBoundingClientRect — every test needs a nonzero scroll-container
// height or it computes an empty visible range (jsdom's default layout is
// all-zero) and renders no rows at all, loaded data notwithstanding.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.classList?.contains('overflow-y-auto') ? 400 : 56; },
  });
});

beforeEach(() => {
  vi.spyOn(subsonic, 'getGenres').mockResolvedValue([
    { value: 'Rock', songCount: 3 },
    { value: 'Pop', songCount: 2 },
  ]);
});

afterEach(() => {
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  vi.restoreAllMocks();
});

describe('AllSongsPage', () => {
  it('shows loading skeleton, then the header/stats and songs once loaded', async () => {
    vi.spyOn(subsonic, 'getAllSongs').mockResolvedValue([song('1'), song('2')]);
    vi.spyOn(subsonic, 'getLibraryStats').mockResolvedValue({ trackCount: 2 });

    renderPage();
    expect(await screen.findByText('All Songs')).toBeInTheDocument();
    expect(await screen.findByText('Song 1')).toBeInTheDocument();
    expect(screen.getByText('Every track in your library · 2 songs')).toBeInTheDocument();
  });

  it('shows an error message when the query fails', async () => {
    vi.spyOn(subsonic, 'getAllSongs').mockRejectedValue(new Error('boom'));
    vi.spyOn(subsonic, 'getLibraryStats').mockResolvedValue({ trackCount: 0 });

    renderPage();
    expect(await screen.findByText('Failed to load songs.')).toBeInTheDocument();
  });

  it('shows an empty-library message when there are no songs', async () => {
    vi.spyOn(subsonic, 'getAllSongs').mockResolvedValue([]);
    vi.spyOn(subsonic, 'getLibraryStats').mockResolvedValue({ trackCount: 0 });

    renderPage();
    expect(await screen.findByText(/No songs found/)).toBeInTheDocument();
  });

  it('only renders a small subset of song rows in the DOM, not the entire loaded page, when the visible area is small', async () => {
    const allSongs = Array.from({ length: 200 }, (_, i) => song(String(i + 1)));
    vi.spyOn(subsonic, 'getAllSongs').mockImplementation(async (offset, limit) => allSongs.slice(offset, offset + limit));
    vi.spyOn(subsonic, 'getLibraryStats').mockResolvedValue({ trackCount: allSongs.length });

    renderPage();
    await screen.findByText('Song 1');

    await waitFor(() => {
      const rendered = screen.getAllByText(/^Song \d+$/);
      // A 400px-tall viewport with ~56px rows fits roughly a dozen rows
      // (plus overscan) — nowhere near all 200 loaded songs.
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(50);
    });
  });

  it('automatically fetches the next page on scroll proximity to the loaded end — no manual "Load more" button', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => song(String(i + 1)));
    const page2 = Array.from({ length: 10 }, (_, i) => song(String(201 + i)));
    const getAllSongsMock = vi.spyOn(subsonic, 'getAllSongs').mockImplementation(async (offset) =>
      offset === 0 ? page1 : offset === 200 ? page2 : [],
    );
    vi.spyOn(subsonic, 'getLibraryStats').mockResolvedValue({ trackCount: 210 });

    renderPage();
    await screen.findByText('Song 1');
    expect(screen.queryByText(/Load more/)).not.toBeInTheDocument();
    expect(getAllSongsMock).toHaveBeenCalledTimes(1); // only page 1 so far

    const scrollContainer = document.querySelector('.overflow-y-auto') as HTMLElement;
    scrollContainer.scrollTop = 200 * 56; // near the bottom of page 1's total rendered height
    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(getAllSongsMock).toHaveBeenCalledWith(200, 200, { genre: undefined, sort: 'title', quality: undefined });
    });
    expect(await screen.findByText('Song 201')).toBeInTheDocument();
  });

  it('refetches with the chosen genre and sort', async () => {
    const getAll = vi.spyOn(subsonic, 'getAllSongs').mockResolvedValue([song('1')]);
    vi.spyOn(subsonic, 'getLibraryStats').mockResolvedValue({ trackCount: 1 });

    renderPage();
    await screen.findByText('Song 1');
    await screen.findByRole('option', { name: 'Rock (3)' });

    fireEvent.change(screen.getByLabelText('Filter by genre'), { target: { value: 'Rock' } });
    await waitFor(() =>
      expect(getAll).toHaveBeenLastCalledWith(0, 200, { genre: 'Rock', sort: 'title', quality: undefined }),
    );

    fireEvent.change(screen.getByLabelText('Sort songs'), { target: { value: 'added_desc' } });
    await waitFor(() =>
      expect(getAll).toHaveBeenLastCalledWith(0, 200, { genre: 'Rock', sort: 'added_desc', quality: undefined }),
    );
  });

  it('refetches with the quality filter', async () => {
    const getAll = vi.spyOn(subsonic, 'getAllSongs').mockResolvedValue([song('1')]);
    vi.spyOn(subsonic, 'getLibraryStats').mockResolvedValue({ trackCount: 1 });

    renderPage();
    await screen.findByText('Song 1');
    fireEvent.change(screen.getByLabelText('Filter by audio quality'), { target: { value: 'hires' } });

    await waitFor(() =>
      expect(getAll).toHaveBeenLastCalledWith(0, 200, { genre: undefined, sort: 'title', quality: 'hires' }),
    );
  });
});
