import { describe, it, expect } from 'vitest';
import {
  approxSubstringDistance, fuzzyRank, maxEditsFor, normalizeForFuzzy, trigramOrQuery,
} from '../db/fuzzy.js';

describe('normalizeForFuzzy', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(normalizeForFuzzy('Beyoncé — Halo!')).toBe('beyonce halo');
  });
});

describe('approxSubstringDistance', () => {
  it('is 0 for an exact substring', () => {
    expect(approxSubstringDistance('rhaps', 'bohemian rhapsody')).toBe(0);
  });
  it('counts a swap of neighbours as one edit', () => {
    expect(approxSubstringDistance('bohemain', 'bohemian rhapsody')).toBe(1);
  });
  it('counts a wrong, a missing and an extra letter as one edit each', () => {
    expect(approxSubstringDistance('beatels', 'the beatles')).toBe(1);
    expect(approxSubstringDistance('beatls', 'beatles')).toBe(1);
    expect(approxSubstringDistance('beatless', 'beatles')).toBe(1);
  });
  it('is large for unrelated text', () => {
    expect(approxSubstringDistance('metallica', 'abba')).toBeGreaterThan(3);
  });
});

describe('maxEditsFor', () => {
  it('allows one edit for most queries and two for long ones', () => {
    expect(maxEditsFor(4)).toBe(1);
    expect(maxEditsFor(8)).toBe(1);
    expect(maxEditsFor(9)).toBe(2);
  });
});

describe('trigramOrQuery', () => {
  it('ORs every trigram as a quoted phrase', () => {
    expect(trigramOrQuery('beat')).toBe('"bea" OR "eat"');
  });
  it('cannot be turned into FTS syntax by the query', () => {
    expect(trigramOrQuery('a" OR "b*')).not.toMatch(/\*/);
  });
  it('returns null when there is no trigram', () => {
    expect(trigramOrQuery('ab')).toBeNull();
  });
});

describe('fuzzyRank', () => {
  const names = ['The Beatles', 'Beach Boys', 'Metallica', 'Beautiful South'];
  it('keeps close matches, best first', () => {
    expect(fuzzyRank('beatels', names, (n) => n)).toEqual(['The Beatles']);
  });
  it('ties keep the incoming (relevance) order', () => {
    expect(fuzzyRank('beatle', ['x beatles', 'y beatles'], (n) => n)).toEqual(['x beatles', 'y beatles']);
  });
  it('refuses queries too short to judge', () => {
    expect(fuzzyRank('bea', names, (n) => n)).toEqual([]);
  });
});
