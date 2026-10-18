export type LinkableTerm = { id: string; term: string; aliases?: string[] };
export type TermMatch = { start: number; end: number; id: string };

const MIN_NAME_CHARS = 2;

/**
 * Where glossary terms occur in one piece of plain text. Longest name first, so 股利殖利率 wins
 * over 股利; matches never overlap; each term id is linked once (its earliest occurrence, under
 * its name or any alias). Names (a term or an alias) shorter than two characters are ignored. Matching is
 * exact: the caller passes only text nodes outside links and code, and keeps the used-id state
 * between nodes by dropping ids it has already linked from `terms`.
 */
export function findTermMatches(text: string, terms: readonly LinkableTerm[]): TermMatch[] {
  if (text === "") return [];
  const candidates: { start: number; end: number; id: string }[] = [];
  for (const entry of terms) {
    const names = new Set([entry.term, ...(entry.aliases ?? [])]);
    for (const name of names) {
      if (name.length < MIN_NAME_CHARS) continue;
      for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
        candidates.push({ start: at, end: at + name.length, id: entry.id });
      }
    }
  }
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const taken: TermMatch[] = [];
  for (const candidate of candidates) {
    if (taken.some((m) => candidate.start < m.end && m.start < candidate.end)) continue;
    taken.push(candidate);
  }
  taken.sort((a, b) => a.start - b.start);
  // Overlaps are settled over every occurrence; then each id keeps only its earliest one.
  const linked = new Set<string>();
  return taken.filter((m) => !linked.has(m.id) && linked.add(m.id));
}
