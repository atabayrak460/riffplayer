/** Typo-tolerant matching for search, used when an exact search finds nothing.
 *
 * The trigram FTS5 tables only match exact substrings, so one wrong letter
 * ("Beatels") finds nothing. A fuzzy search first collects candidates that
 * share trigrams with the query (a typo spoils at most three of them), then
 * keeps the ones whose text contains something within a few edits of it. */

/** Lowercase, strip accents, collapse punctuation — so "Beyoncé" ≈ "beyonce". */
export function normalizeForFuzzy(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** How many edits a query of this length may be off by. One for most words,
 * two only for long queries, where a second slip is still unambiguous. */
export function maxEditsFor(queryLength: number): number {
  return queryLength >= 9 ? 2 : 1;
}

/** Smallest number of edits (insert, delete, replace, swap of two neighbours)
 * to turn `query` into some substring of `text` — approximate substring
 * matching (Sellers), so "bohemain" is 1 away from "Bohemian Rhapsody". Both
 * arguments are expected to be normalized already. */
export function approxSubstringDistance(query: string, text: string): number {
  const m = query.length;
  const n = text.length;
  if (m === 0) return 0;
  // d[i][j]: best cost of matching query[0..i) ending at text position j; a
  // match may start anywhere in the text, so row 0 is all zeros.
  let prev2: number[] | null = null;
  let prev: number[] = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = new Array<number>(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = query[i - 1] === text[j - 1] ? 0 : 1;
      let best = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (
        prev2 !== null && i > 1 && j > 1 &&
        query[i - 1] === text[j - 2] && query[i - 2] === text[j - 1]
      ) {
        best = Math.min(best, prev2[j - 2] + 1);
      }
      cur[j] = best;
    }
    prev2 = prev;
    prev = cur;
  }
  return Math.min(...prev);
}

/** FTS5 MATCH expression that finds anything sharing at least one trigram with
 * the query. Every trigram is a quoted phrase (embedded quotes doubled), so it
 * can't be read as FTS5 syntax. Returns null if there's nothing to match. */
export function trigramOrQuery(query: string): string | null {
  const text = normalizeForFuzzy(query);
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= text.length; i++) {
    const g = text.slice(i, i + 3);
    if (g.trim().length === 3) grams.add(g);
  }
  if (grams.size === 0) return null;
  return [...grams].map((g) => `"${g.replace(/"/g, '""')}"`).join(' OR ');
}

/** Shortest query worth a fuzzy search: a 3-letter query has a single trigram,
 * which one typo wipes out. */
export const MIN_FUZZY_QUERY_LENGTH = 4;

/** Keeps the candidates within the allowed edits of the query, closest first
 * (ties keep the order given, which is the FTS relevance order). */
export function fuzzyRank<T>(query: string, candidates: T[], textOf: (c: T) => string): T[] {
  const q = normalizeForFuzzy(query);
  if (q.length < MIN_FUZZY_QUERY_LENGTH) return [];
  const limit = maxEditsFor(q.length);
  const scored: { item: T; dist: number; order: number }[] = [];
  candidates.forEach((item, order) => {
    const dist = approxSubstringDistance(q, normalizeForFuzzy(textOf(item)));
    if (dist <= limit) scored.push({ item, dist, order });
  });
  scored.sort((a, b) => a.dist - b.dist || a.order - b.order);
  return scored.map((s) => s.item);
}
