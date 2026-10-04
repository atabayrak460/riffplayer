// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QualityBadge } from './QualityBadge';
import type { Song } from '../api/types';

const song = (extra: Partial<Song>): Song => ({
  id: '1', title: 't', album: 'a', albumId: 'al', artist: 'ar', artistId: 'ar1',
  created: '2024-01-01', isVideo: false, type: 'music', ...extra,
});

describe('QualityBadge', () => {
  it('shows Hi-Res with the details as a tooltip', () => {
    render(<QualityBadge song={song({ suffix: 'flac', lossless: true, bitDepth: 24, samplingRate: 96000 })} />);
    const badge = screen.getByText('Hi-Res');
    expect(badge).toHaveAttribute('data-quality', 'hires');
    expect(badge).toHaveAttribute('title', 'FLAC · 24-bit / 96 kHz');
  });

  it('shows the format for a lossy file', () => {
    render(<QualityBadge song={song({ suffix: 'mp3', lossless: false })} />);
    expect(screen.getByText('MP3')).toHaveAttribute('data-quality', 'lossy');
  });

  it('renders nothing when the format is unknown', () => {
    const { container } = render(<QualityBadge song={song({})} />);
    expect(container).toBeEmptyDOMElement();
  });
});
