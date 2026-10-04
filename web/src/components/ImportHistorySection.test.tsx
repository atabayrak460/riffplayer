// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportHistorySection } from './ImportHistorySection';
import * as subsonic from '../api/subsonic';

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ImportHistorySection /></QueryClientProvider>);
}

const result = (over: Partial<subsonic.ImportResult> = {}): subsonic.ImportResult => ({
  source: 'spotify', files: 1, found: 10, added: 8, duplicates: 2, matched: 3, ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(subsonic, 'getImportedHistory').mockResolvedValue([]);
});

describe('ImportHistorySection', () => {
  it('uploads an export file and reports what was added', async () => {
    const upload = vi.spyOn(subsonic, 'importHistoryFile').mockResolvedValue(result());
    renderIt();
    const file = new File(['[]'], 'my_spotify_data.zip');
    await userEvent.upload(screen.getByLabelText('Spotify or Apple Music export'), file);

    await waitFor(() => expect(upload.mock.calls[0][0]).toBe(file));
    expect(await screen.findByText('8 plays added from Spotify, 2 already counted.')).toBeInTheDocument();
  });

  it("shows the server's reason when a file is refused", async () => {
    vi.spyOn(subsonic, 'importHistoryFile').mockRejectedValue(new Error('Not a recognised export.'));
    renderIt();
    await userEvent.upload(screen.getByLabelText('Spotify or Apple Music export'), new File(['x'], 'a.csv'));
    expect(await screen.findByText('Not a recognised export.')).toBeInTheDocument();
  });

  it('imports a Last.fm profile for the chosen year', async () => {
    const lastfm = vi.spyOn(subsonic, 'importLastFm').mockResolvedValue(result({ source: 'lastfm', added: 5, duplicates: 0 }));
    renderIt();
    expect(screen.getByRole('button', { name: 'Import from Last.fm' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Last.fm username'), ' someone ');
    await userEvent.selectOptions(screen.getByLabelText('Year to import'), String(new Date().getFullYear() - 1));
    await userEvent.click(screen.getByRole('button', { name: 'Import from Last.fm' }));

    await waitFor(() => expect(lastfm).toHaveBeenCalledWith('someone', new Date().getFullYear() - 1));
    expect(await screen.findByText('5 plays added from Last.fm.')).toBeInTheDocument();
  });

  it('lists what was imported and removes one source', async () => {
    vi.spyOn(subsonic, 'getImportedHistory').mockResolvedValue([
      { source: 'apple_music', plays: 1200, matched: 300, firstPlayedAt: 1, lastPlayedAt: 2 },
    ]);
    const remove = vi.spyOn(subsonic, 'removeImportedHistory').mockResolvedValue();
    renderIt();
    expect(await screen.findByText('1,200 plays · 300 in your library')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(remove.mock.calls[0][0]).toBe('apple_music'));
  });
});
