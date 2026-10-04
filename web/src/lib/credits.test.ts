import { describe, it, expect } from 'vitest';
import { creditRows } from './credits';

describe('creditRows', () => {
  it('is empty for nothing', () => {
    expect(creditRows(undefined)).toEqual([]);
    expect(creditRows({})).toEqual([]);
  });

  it('joins lists, keeps a fixed order and skips empties', () => {
    expect(creditRows({
      isrc: ['X1'], composers: ['A', 'B'], producers: [], copyright: '2020 Label', bpm: 120, originalYear: 1999,
    })).toEqual([
      ['Composer', 'A, B'],
      ['ISRC', 'X1'],
      ['Original year', '1999'],
      ['BPM', '120'],
      ['Copyright', '2020 Label'],
    ]);
  });
});
