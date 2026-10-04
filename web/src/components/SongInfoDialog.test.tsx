// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SongInfoDialog } from './SongInfoDialog';
import * as subsonic from '../api/subsonic';
import type { Song } from '../api/types';

const song: Song = {
  id: 't-1', title: 'Test Song', album: 'Test Album', albumId: 'al-1', artist: 'Test Artist', artistId: 'ar-1',
  created: '2024-01-01', isVideo: false, type: 'music', suffix: 'mp3', duration: 200,
};

const flac: Song = { ...song, suffix: 'flac', lossless: true, bitDepth: 24, samplingRate: 96000, channelCount: 2, bitRate: 2304 };

function renderDialog(s: Song) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SongInfoDialog song={s} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(subsonic, 'getMyTranscodePrefs').mockResolvedValue({ transcode_format: null, transcode_bitrate: null });
  vi.spyOn(subsonic, 'getTrackCredits').mockResolvedValue({});
});

describe('SongInfoDialog', () => {
  it('renders as an accessible dialog with the song details', () => {
    renderDialog(song);
    expect(screen.getByRole('dialog', { name: 'Song info' })).toBeInTheDocument();
    expect(screen.getByText('Test Song')).toBeInTheDocument();
    expect(screen.getByText('Test Artist')).toBeInTheDocument();
  });

  it('lists the sample rate and bit depth when known', () => {
    renderDialog(flac);
    expect(screen.getByText('96 kHz')).toBeInTheDocument();
    expect(screen.getByText('24-bit')).toBeInTheDocument();
  });

  it('shows the signal path with a Hi-Res badge for a hi-res file sent unchanged', async () => {
    renderDialog(flac);
    const path = screen.getByRole('region', { name: 'Signal path' });
    expect(within(path).getByText('Hi-Res')).toBeInTheDocument();
    expect(within(path).getByText(/FLAC · 24-bit \/ 96 kHz/)).toBeInTheDocument();
    expect(await within(path).findByText('Original file, sent unchanged')).toBeInTheDocument();
  });

  it('warns when the server converts a lossless file for this user', async () => {
    vi.spyOn(subsonic, 'getMyTranscodePrefs').mockResolvedValue({ transcode_format: 'mp3', transcode_bitrate: 192 });
    renderDialog(flac);
    const step = await screen.findByText(/Converted by the server to MP3 at up to 192 kbps/);
    expect(step).toHaveClass('text-amber-400');
  });

  it('has no signal path for a file whose format is unknown', () => {
    renderDialog({ ...song, suffix: undefined });
    expect(screen.queryByRole('region', { name: 'Signal path' })).not.toBeInTheDocument();
  });

  it('shows the credits the file carries, in a fixed order', async () => {
    vi.spyOn(subsonic, 'getTrackCredits').mockResolvedValue({
      labels: ['Some Label'], composers: ['Jane Composer', 'Joe Co-writer'], isrc: ['GBAYE0000001'],
    });
    renderDialog(song);
    const credits = await screen.findByRole('region', { name: 'Credits' });
    const labels = within(credits).getAllByRole('term').map((t) => t.textContent);
    expect(labels).toEqual(['Composer', 'Label', 'ISRC']);
    expect(within(credits).getByText('Jane Composer, Joe Co-writer')).toBeInTheDocument();
  });

  it('shows no credits section when the file has none or they cannot be loaded', async () => {
    vi.spyOn(subsonic, 'getTrackCredits').mockRejectedValue(new Error('The file could not be read'));
    renderDialog(song);
    await screen.findByText('Test Song');
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('region', { name: 'Credits' })).not.toBeInTheDocument();
  });
});
