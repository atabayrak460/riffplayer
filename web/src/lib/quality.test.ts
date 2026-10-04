import { describe, it, expect } from 'vitest';
import { albumQuality, audioQuality, signalPath, willTranscode } from './quality';
import type { Song } from '../api/types';

const song = (extra: Partial<Song> = {}): Song => ({
  id: '1', title: 't', album: 'a', albumId: 'al', artist: 'ar', artistId: 'ar1',
  created: '2024-01-01', isVideo: false, type: 'music', ...extra,
});

describe('audioQuality', () => {
  it('calls 24-bit lossless Hi-Res and describes it', () => {
    const q = audioQuality(song({ suffix: 'flac', lossless: true, bitDepth: 24, samplingRate: 96000, channelCount: 2, bitRate: 2304 }));
    expect(q.tier).toBe('hires');
    expect(q.label).toBe('Hi-Res');
    expect(q.summary).toBe('FLAC · 24-bit / 96 kHz · Stereo · 2304 kbps');
  });

  it('calls a 16-bit / 44.1 kHz lossless file plain Lossless', () => {
    expect(audioQuality(song({ suffix: 'flac', lossless: true, bitDepth: 16, samplingRate: 44100 })).tier).toBe('lossless');
  });

  it('treats 48 kHz / 16-bit as Lossless, but 24-bit at 44.1 kHz or 16-bit above 48 kHz as Hi-Res', () => {
    expect(audioQuality(song({ suffix: 'wav', lossless: true, bitDepth: 16, samplingRate: 48000 })).tier).toBe('lossless');
    expect(audioQuality(song({ suffix: 'flac', lossless: true, bitDepth: 24, samplingRate: 44100 })).tier).toBe('hires');
    expect(audioQuality(song({ suffix: 'flac', lossless: true, bitDepth: 16, samplingRate: 88200 })).tier).toBe('hires');
  });

  it('labels a lossy file by its format', () => {
    const q = audioQuality(song({ suffix: 'mp3', lossless: false, bitRate: 320, samplingRate: 44100, channelCount: 2 }));
    expect(q.tier).toBe('lossy');
    expect(q.label).toBe('MP3');
    expect(q.summary).toBe('MP3 · 44.1 kHz · Stereo · 320 kbps');
  });

  it('falls back to the file extension when the server has not reported losslessness yet', () => {
    expect(audioQuality(song({ suffix: 'flac' })).tier).toBe('lossless');
    expect(audioQuality(song({ suffix: 'ogg' })).tier).toBe('lossy');
    // m4a may be AAC or ALAC — don't guess
    expect(audioQuality(song({ suffix: 'm4a' })).tier).toBe('unknown');
  });

  it('has no label when nothing is known', () => {
    expect(audioQuality(song()).label).toBeNull();
  });

  it('does not use a long codec name as a short chip', () => {
    const q = audioQuality(song({ suffix: 'mp3', codec: 'MPEG 1 Layer 3', lossless: false }));
    expect(q.summary.startsWith('MP3')).toBe(true);
  });
});

describe('willTranscode (mirrors the server)', () => {
  const flac = song({ suffix: 'flac', bitRate: 900 });
  it('is false without preferences or with empty ones', () => {
    expect(willTranscode(flac, null)).toBeNull();
    expect(willTranscode(flac, { transcode_format: null, transcode_bitrate: null })).toBeNull();
  });
  it('converts when the preferred format differs from the file', () => {
    expect(willTranscode(flac, { transcode_format: 'mp3', transcode_bitrate: null })).toEqual({ format: 'mp3', bitrate: null });
  });
  it('does not convert when the file already is the preferred format', () => {
    expect(willTranscode(flac, { transcode_format: 'flac', transcode_bitrate: null })).toBeNull();
    expect(willTranscode(flac, { transcode_format: 'raw', transcode_bitrate: null })).toBeNull();
  });
  it('converts when the file is above the bitrate cap, but not below it', () => {
    expect(willTranscode(flac, { transcode_format: null, transcode_bitrate: 320 })).toEqual({ format: 'mp3', bitrate: 320 });
    expect(willTranscode(song({ suffix: 'mp3', bitRate: 192 }), { transcode_format: null, transcode_bitrate: 320 })).toBeNull();
  });
});

describe('signalPath', () => {
  const flac = song({ suffix: 'flac', lossless: true, bitDepth: 24, samplingRate: 96000 });

  it('goes source → delivery → playback and says when nothing was changed', () => {
    const steps = signalPath(flac, null);
    expect(steps.map((s) => s.stage)).toEqual(['Source', 'Delivery', 'Playback']);
    expect(steps[1].text).toBe('Original file, sent unchanged');
    expect(steps[1].degraded).toBeFalsy();
  });

  it('marks a conversion of a lossless file as lowering quality', () => {
    const steps = signalPath(flac, { transcode_format: 'opus', transcode_bitrate: 128 });
    expect(steps[1].text).toContain('OPUS at up to 128 kbps');
    expect(steps[1].degraded).toBe(true);
  });

  it('names the playing device', () => {
    expect(signalPath(flac, null, 'this phone')[2].text).toContain('this phone');
  });
});

describe('albumQuality', () => {
  const hi = song({ suffix: 'flac', lossless: true, bitDepth: 24, samplingRate: 96000 });
  const cd = song({ suffix: 'flac', lossless: true, bitDepth: 16, samplingRate: 44100 });
  const mp3 = song({ suffix: 'mp3', lossless: false });

  it('is Hi-Res when any track is, and says how many', () => {
    const q = albumQuality([hi, cd, mp3]);
    expect(q?.tier).toBe('hires');
    expect(q?.summary).toContain('1 of 3 tracks');
  });

  it('is Lossless when no track is Hi-Res but some are lossless', () => {
    expect(albumQuality([cd, mp3])?.tier).toBe('lossless');
  });

  it('shows the format when every track is the same lossy format', () => {
    expect(albumQuality([mp3, mp3])?.label).toBe('MP3');
  });

  it('says nothing for mixed lossy formats, unknowns or an empty album', () => {
    expect(albumQuality([mp3, song({ suffix: 'ogg', lossless: false })])).toBeNull();
    expect(albumQuality([song({})])).toBeNull();
    expect(albumQuality([])).toBeNull();
  });
});
