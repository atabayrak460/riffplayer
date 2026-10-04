// The queue of the *other* device as this device shows it (RiffPlayer Connect, docs/CONNECT-DESIGN.md §16).
// Pure helpers: the queue view the connect store keeps, and the optimistic edits applied to it while the
// real edit travels to the playing device.

import type { Song } from '../api/types';

export interface RemoteQueueView {
  /** The queue version this view was fetched at; a newer one in the device's state means "refetch". */
  version: number;
  songs: Song[];
  /** Real queue position of each song — ids the library no longer knows are missing from `songs`. */
  positions: number[];
  /** Index into `songs` of the song being played, or -1. */
  index: number;
}

/** Index into `view.songs` for a real queue position (the device's `state.index`), or -1 if it isn't shown. */
export function viewIndexOf(positions: number[], realIndex: number): number {
  return positions.indexOf(realIndex);
}

/** The view after moving the song at `from` to `to` (same semantics as a local reorder; the current song follows). */
export function moveInView(view: RemoteQueueView, from: number, to: number): RemoteQueueView {
  if (from === to || from < 0 || to < 0 || from >= view.songs.length || to >= view.songs.length) return view;
  const songs = [...view.songs];
  const [moved] = songs.splice(from, 1);
  songs.splice(to, 0, moved);
  let index = view.index;
  if (from === index) index = to;
  else if (from < index && to >= index) index--;
  else if (from > index && to <= index) index++;
  // `positions` are slots in the real queue, not properties of a song: they stay where they are.
  return { ...view, songs, index };
}

/** The view after removing the song at `at`; later songs move up one real position. */
export function removeFromView(view: RemoteQueueView, at: number): RemoteQueueView {
  if (at < 0 || at >= view.songs.length) return view;
  const songs = view.songs.filter((_, i) => i !== at);
  const positions = view.positions.filter((_, i) => i !== at).map((p, i) => (i >= at ? p - 1 : p));
  let index = view.index;
  if (at < index) index--;
  else if (at === index) index = -1;
  return { ...view, songs, positions, index };
}
