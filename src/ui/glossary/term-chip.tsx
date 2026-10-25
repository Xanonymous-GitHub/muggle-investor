"use client";

import { GLOSSARY } from "@/glossary/terms";

// Not the `@/glossary` barrel: it re-exports the Zod schemas, which the client has no use for.
const NAMES = new Map(GLOSSARY.map((term) => [term.id, term.term]));

/**
 * A small pill showing a glossary term's name; tapping it opens the term panel. The name comes
 * from the bundled vocabulary, so a chip needs no request. An id it does not know renders nothing.
 * `label` replaces the name when the chip stands in for words the reader wrote (an alias).
 * `inline` is for running text (an answer): the term stays on the line, tinted and underlined,
 * and does not make its line taller the way the pill does; its tap area reaches past the text
 * through a pseudo-element, so the paragraph's line height is untouched.
 */
export function TermChip({
  termId,
  onOpen,
  label,
  variant = "pill",
}: {
  termId: string;
  onOpen(termId: string): void;
  label?: string;
  variant?: "pill" | "inline";
}) {
  const name = NAMES.get(termId);
  if (name === undefined) return null;
  return (
    <button
      type="button"
      data-term-chip={variant}
      onClick={() => onOpen(termId)}
      className={
        variant === "inline"
          ? "relative box-decoration-clone rounded-sm bg-muted px-1 text-foreground underline decoration-muted-foreground decoration-dotted underline-offset-4 outline-none after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          : "inline-flex min-h-8 items-center rounded-full border bg-muted px-3 py-1 text-sm text-foreground outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      }
    >
      {label ?? name}
    </button>
  );
}
