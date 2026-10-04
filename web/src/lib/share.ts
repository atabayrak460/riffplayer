import { getPlaylistShareImage, getPlaylistSharePages, getSongShareImage } from '../api/subsonic';
import { useToastStore } from '../store/toast';
import type { Playlist, Song } from '../api/types';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** A safe file name: letters/digits/spaces from the title, never empty, no path characters. */
export function fileNameFor(title: string, suffix = ''): string {
  const base = title.replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/\s+/g, ' ').replace(/^[. ]+/, '').trim().slice(0, 60) || 'riffplayer';
  return `${base}${suffix}.png`;
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens the system share sheet with the pictures when the browser can (phones, some desktops),
 *  otherwise saves them as downloads. Backing out of the share sheet is not an error. */
export async function shareImages(files: File[], title: string): Promise<ShareOutcome> {
  const data = { files, title };
  if (typeof navigator.canShare === 'function' && navigator.canShare(data)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Any other failure: fall through to the download.
    }
  }
  files.forEach(download);
  return 'downloaded';
}

async function run(job: () => Promise<ShareOutcome>): Promise<void> {
  const toast = useToastStore.getState();
  toast.show('Preparing picture…');
  try {
    const outcome = await job();
    if (outcome === 'downloaded') toast.show('Picture saved to your downloads');
    else toast.dismiss();
  } catch (e) {
    toast.show(e instanceof Error && e.message ? `Couldn't create the picture: ${e.message}` : "Couldn't create the picture");
  }
}

export function shareSong(song: Song): Promise<void> {
  return run(async () => {
    const blob = await getSongShareImage(song.id);
    return shareImages([new File([blob], fileNameFor(`${song.artist} - ${song.title}`), { type: 'image/png' })], song.title);
  });
}

export function sharePlaylist(playlist: Playlist): Promise<void> {
  return run(async () => {
    const pages = await getPlaylistSharePages(playlist.id);
    const files: File[] = [];
    for (let n = 1; n <= pages; n++) {
      const blob = await getPlaylistShareImage(playlist.id, n);
      files.push(new File([blob], fileNameFor(playlist.name, pages > 1 ? ` ${n}` : ''), { type: 'image/png' }));
    }
    return shareImages(files, playlist.name);
  });
}
