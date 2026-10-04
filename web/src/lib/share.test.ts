// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as subsonic from '../api/subsonic';
import { fileNameFor, shareImages, shareSong, sharePlaylist } from './share';
import { useToastStore } from '../store/toast';
import type { Playlist, Song } from '../api/types';

const song = { id: 's1', title: 'Karma Police', artist: 'Radiohead', album: 'OK Computer' } as Song;
const playlist = { id: 'p1', name: 'Road trip / 2024' } as Playlist;
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

function mockShare(impl: 'ok' | 'abort' | 'fail' | 'unsupported') {
  const share = vi.fn(async () => {
    if (impl === 'abort') throw new DOMException('cancelled', 'AbortError');
    if (impl === 'fail') throw new Error('boom');
  });
  Object.defineProperty(navigator, 'share', { configurable: true, value: impl === 'unsupported' ? undefined : share });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: impl === 'unsupported' ? undefined : () => true });
  return share;
}

let clicked: string[];
beforeEach(() => {
  vi.restoreAllMocks();
  useToastStore.setState({ message: null });
  clicked = [];
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });
});

describe('fileNameFor', () => {
  it('keeps letters (also non-Latin) and drops path characters', () => {
    expect(fileNameFor('Road trip / 2024')).toBe('Road trip 2024.png');
    expect(fileNameFor('Şarkı: İstanbul?')).toBe('Şarkı İstanbul.png');
    expect(fileNameFor('../../etc/passwd')).toBe('etcpasswd.png'); // no hidden or traversal-looking names
  });
  it('is never empty and is length-limited', () => {
    expect(fileNameFor('???')).toBe('riffplayer.png');
    expect(fileNameFor('x'.repeat(500)).length).toBeLessThanOrEqual(64);
    expect(fileNameFor('Mix', ' 2')).toBe('Mix 2.png');
  });
});

describe('shareImages', () => {
  const file = () => new File([png()], 'a.png', { type: 'image/png' });

  it('uses the system share sheet when the browser offers it', async () => {
    const share = mockShare('ok');
    expect(await shareImages([file()], 'T')).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([]);
  });

  it('treats backing out of the share sheet as cancelled, not as an error or a download', async () => {
    mockShare('abort');
    expect(await shareImages([file()], 'T')).toBe('cancelled');
    expect(clicked).toEqual([]);
  });

  it('falls back to downloading if sharing fails or is unsupported', async () => {
    mockShare('fail');
    expect(await shareImages([file(), file()], 'T')).toBe('downloaded');
    expect(clicked).toEqual(['a.png', 'a.png']);

    clicked = [];
    mockShare('unsupported');
    expect(await shareImages([file()], 'T')).toBe('downloaded');
    expect(clicked).toEqual(['a.png']);
  });
});

describe('shareSong', () => {
  it('fetches the picture and shares it under a readable file name', async () => {
    const share = mockShare('ok');
    vi.spyOn(subsonic, 'getSongShareImage').mockResolvedValue(png());
    await shareSong(song);

    expect(subsonic.getSongShareImage).toHaveBeenCalledWith('s1');
    const files = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files;
    expect(files.map((f) => f.name)).toEqual(['Radiohead - Karma Police.png']);
    expect(useToastStore.getState().message).toBeNull(); // the "preparing" note is cleared
  });

  it('tells the user when the picture could not be made', async () => {
    mockShare('ok');
    vi.spyOn(subsonic, 'getSongShareImage').mockRejectedValue(new Error('Song not found'));
    await shareSong(song);
    expect(useToastStore.getState().message).toBe("Couldn't create the picture: Song not found");
  });

  it('says where a downloaded picture went', async () => {
    mockShare('unsupported');
    vi.spyOn(subsonic, 'getSongShareImage').mockResolvedValue(png());
    await shareSong(song);
    expect(useToastStore.getState().message).toBe('Picture saved to your downloads');
  });
});

describe('sharePlaylist', () => {
  it('fetches every page, in order, and shares them together', async () => {
    const share = mockShare('ok');
    vi.spyOn(subsonic, 'getPlaylistSharePages').mockResolvedValue(3);
    const page = vi.spyOn(subsonic, 'getPlaylistShareImage').mockResolvedValue(png());
    await sharePlaylist(playlist);

    expect(page.mock.calls.map((c) => c[1])).toEqual([1, 2, 3]);
    const files = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files;
    expect(files.map((f) => f.name)).toEqual(['Road trip 2024 1.png', 'Road trip 2024 2.png', 'Road trip 2024 3.png']);
  });

  it('a one-page playlist gets a plain file name', async () => {
    const share = mockShare('ok');
    vi.spyOn(subsonic, 'getPlaylistSharePages').mockResolvedValue(1);
    vi.spyOn(subsonic, 'getPlaylistShareImage').mockResolvedValue(png());
    await sharePlaylist(playlist);
    const files = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files;
    expect(files.map((f) => f.name)).toEqual(['Road trip 2024.png']);
  });
});
