/**
 * Names differ between services ("Song - 2011 Remaster", "Song (feat. X)", different accents or
 * punctuation), so plays are matched on a normalised artist + title.
 */
export function normaliseName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([](?:feat|ft|featuring|with)\b[^)\]]*[)\]]/g, '')
    .replace(/\s*[([][^)\]]*(?:remaster|remastered|mono|stereo|deluxe|bonus|live|version|edit)[^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|mono|stereo|live|single version|radio edit)\b.*$/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchKey(artist: string, title: string): string {
  return `${normaliseName(artist)}|${normaliseName(title)}`;
}
