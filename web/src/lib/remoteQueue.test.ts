import { describe, it, expect } from 'vitest';
import { moveInView, removeFromView, viewIndexOf, type RemoteQueueView } from './remoteQueue';
import type { Song } from '../api/types';

const song = (id: string) => ({ id, title: id }) as Song;
const view = (ids: string[], index: number, positions = ids.map((_, i) => i)): RemoteQueueView => ({
  version: 1, songs: ids.map(song), positions, index,
});
const ids = (v: RemoteQueueView) => v.songs.map((s) => s.id);

describe('viewIndexOf', () => {
  it('maps a real queue position to the shown index', () => {
    expect(viewIndexOf([0, 2, 3], 2)).toBe(1);
    expect(viewIndexOf([0, 2, 3], 1)).toBe(-1); // that id is not in the library any more
  });
});

describe('moveInView', () => {
  it('moves a song and keeps the current one pointing at the same song', () => {
    // a b [c] d e: move a behind c -> b c? current c shifts up
    const v = moveInView(view(['a', 'b', 'c', 'd', 'e'], 2), 0, 3);
    expect(ids(v)).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(v.index).toBe(1);
    expect(v.songs[v.index].id).toBe('c');
  });

  it('follows the current song when it is the one that moves', () => {
    const v = moveInView(view(['a', 'b', 'c', 'd'], 1), 1, 3);
    expect(ids(v)).toEqual(['a', 'c', 'd', 'b']);
    expect(v.index).toBe(3);
  });

  it('shifts the current song down when something jumps in front of it', () => {
    const v = moveInView(view(['a', 'b', 'c', 'd'], 1), 3, 0);
    expect(ids(v)).toEqual(['d', 'a', 'b', 'c']);
    expect(v.songs[v.index].id).toBe('b');
  });

  it('leaves the real positions alone and ignores no-ops and bad indexes', () => {
    const base = view(['a', 'b', 'c'], 0, [0, 2, 5]);
    expect(moveInView(base, 0, 2).positions).toEqual([0, 2, 5]);
    expect(moveInView(base, 1, 1)).toBe(base);
    expect(moveInView(base, 0, 9)).toBe(base);
    expect(moveInView(base, -1, 0)).toBe(base);
  });
});

describe('removeFromView', () => {
  it('removes a song and moves the later real positions up', () => {
    const v = removeFromView(view(['a', 'b', 'c', 'd'], 3), 1);
    expect(ids(v)).toEqual(['a', 'c', 'd']);
    expect(v.positions).toEqual([0, 1, 2]);
    expect(v.index).toBe(2);
    expect(v.songs[v.index].id).toBe('d');
  });

  it('keeps the index when the removed song is after the current one, and clears it when it is the current one', () => {
    expect(removeFromView(view(['a', 'b', 'c'], 0), 2).index).toBe(0);
    expect(removeFromView(view(['a', 'b', 'c'], 1), 1).index).toBe(-1);
  });

  it('respects gaps left by unknown ids', () => {
    const v = removeFromView(view(['a', 'b', 'c'], 2, [0, 2, 4]), 1);
    expect(v.positions).toEqual([0, 3]);
  });

  it('ignores an out-of-range index', () => {
    const base = view(['a'], 0);
    expect(removeFromView(base, 5)).toBe(base);
  });
});
