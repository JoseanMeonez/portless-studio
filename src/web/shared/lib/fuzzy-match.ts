const WORD_BOUNDARY = /[\s./:_-]/;

/**
 * Scores how well `query` matches `text`: a plain substring wins, otherwise the query letters
 * must appear in order. Higher is better; `null` means no match. An empty query matches everything.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return 0;
  const haystack = text.toLowerCase();

  const index = haystack.indexOf(needle);
  if (index !== -1) {
    const startsWord = index === 0 || WORD_BOUNDARY.test(haystack[index - 1] ?? "");
    return 1000 - index + (startsWord ? 100 : 0) - (haystack.length - needle.length) / 100;
  }

  let score = 0;
  let from = 0;
  let previous = -2;
  for (const letter of needle) {
    const found = haystack.indexOf(letter, from);
    if (found === -1) return null;
    score += found === previous + 1 ? 5 : 1;
    if (found === 0 || WORD_BOUNDARY.test(haystack[found - 1] ?? "")) score += 3;
    previous = found;
    from = found + 1;
  }
  return score;
}

/** Keeps the items that match and orders them best first, stable for equal scores. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  toText: (item: T) => string,
): T[] {
  if (query.trim() === "") return [...items];
  return items
    .map((item, order) => ({ item, order, score: fuzzyScore(query, toText(item)) }))
    .filter((entry): entry is { item: T; order: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.item);
}
