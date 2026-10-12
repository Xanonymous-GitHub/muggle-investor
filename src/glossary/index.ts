import type { GlossaryTerm } from "./schema";
import { GLOSSARY } from "./terms";

export {
  type GlossaryCategory,
  type GlossaryTerm,
  glossaryCategorySchema,
  glossaryTermSchema,
} from "./schema";
export { GLOSSARY } from "./terms";

const byId = new Map<string, GlossaryTerm>(GLOSSARY.map((term) => [term.id, term]));

export function getTerm(id: string): GlossaryTerm | undefined {
  return byId.get(id);
}

export function termIds(): string[] {
  return GLOSSARY.map((term) => term.id);
}

type Pattern = { text: string; id: string; asciiEdges: { start: boolean; end: boolean } };

const ASCII_LETTER = /[A-Za-z]/;
const isAsciiLetter = (char: string | undefined) => char !== undefined && ASCII_LETTER.test(char);
/** Lower-cases ASCII only, so string lengths (and therefore match offsets) never change. */
const asciiLower = (text: string) => text.replace(/[A-Z]/g, (char) => char.toLowerCase());

/** Every term and alias, longest first, so the first hit at a position is the longest one. */
const patterns: Pattern[] = GLOSSARY.flatMap((term) =>
  [term.term, ...term.aliases].map((text) => ({
    text: asciiLower(text),
    id: term.id,
    asciiEdges: { start: isAsciiLetter(text[0]), end: isAsciiLetter(text.at(-1)) },
  })),
).sort((a, b) => b.text.length - a.text.length);

function matchAt(text: string, lower: string, index: number): Pattern | undefined {
  return patterns.find(
    (pattern) =>
      lower.startsWith(pattern.text, index) &&
      // An ASCII term (e.g. "ETF") must not sit inside a longer English word ("NETFLIX").
      !(pattern.asciiEdges.start && isAsciiLetter(text[index - 1])) &&
      !(pattern.asciiEdges.end && isAsciiLetter(text[index + pattern.text.length])),
  );
}

/**
 * Glossary ids mentioned in `text` (terms or aliases), in order of first appearance, deduped.
 * Scans left to right taking the longest match at each position; matched spans never overlap,
 * so "漲停鎖死" yields `limit-locked`, not also `limit-up`. ASCII matching ignores case.
 */
export function findTermsInText(text: string): string[] {
  const lower = asciiLower(text);
  const found = new Set<string>();
  let index = 0;
  while (index < text.length) {
    const match = matchAt(text, lower, index);
    if (match) {
      found.add(match.id);
      index += match.text.length;
    } else {
      index += 1;
    }
  }
  return [...found];
}
