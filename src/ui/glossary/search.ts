import type { GlossaryCategory, GlossaryTerm } from "@/glossary";

export const CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  market: "市場",
  flow: "資金",
  limit: "漲跌停",
  planning: "規劃",
};

/**
 * Case-insensitive substring search over the term, its aliases and the beginner plain text.
 * A hit on the term or an alias ranks ahead of a hit on the description alone; within a rank the
 * original order is kept. A blank query returns every term unchanged.
 */
export function searchTerms(terms: GlossaryTerm[], query: string): GlossaryTerm[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return terms;
  const has = (text: string) => text.toLowerCase().includes(needle);
  const byName: GlossaryTerm[] = [];
  const byDescription: GlossaryTerm[] = [];
  for (const term of terms) {
    if (has(term.term) || term.aliases.some(has)) byName.push(term);
    else if (has(term.beginner.plain)) byDescription.push(term);
  }
  return [...byName, ...byDescription];
}
