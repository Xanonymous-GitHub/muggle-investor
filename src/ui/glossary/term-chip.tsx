"use client";

import { getTerm } from "@/glossary";

/**
 * A small pill showing a glossary term's name; tapping it opens the term panel. The name comes
 * from the bundled vocabulary, so a chip needs no request. An id it does not know renders nothing.
 */
export function TermChip({ termId, onOpen }: { termId: string; onOpen(termId: string): void }) {
  const term = getTerm(termId);
  if (!term) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(termId)}
      className="inline-flex min-h-8 items-center rounded-full border bg-muted px-3 py-1 text-sm text-foreground outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {term.term}
    </button>
  );
}
