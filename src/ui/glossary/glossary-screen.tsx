"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { GlossaryCategory, GlossaryTerm } from "@/glossary";
import type { Lens } from "@/insight/lens";
import { cn } from "@/lib/utils";
import { useSettings } from "@/ui/device/settings-provider";
import { CATEGORY_LABELS, searchTerms } from "@/ui/glossary/search";
import { useTermPanel } from "@/ui/glossary/term-panel";
import { useGlossary } from "@/ui/glossary/use-glossary";

const CATEGORY_ORDER: GlossaryCategory[] = ["market", "flow", "limit", "planning"];

export function GlossaryScreen() {
  const { terms, byId, status } = useGlossary();
  const { open, panel } = useTermPanel(byId);
  const { settings } = useSettings();
  const [query, setQuery] = useState("");
  const searchId = useId();

  const matches = useMemo(() => searchTerms(terms, query), [terms, query]);
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    terms: matches.filter((term) => term.category === category),
  })).filter((group) => group.terms.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">名詞</h1>

      <Input
        id={searchId}
        type="search"
        aria-label="搜尋名詞"
        placeholder="搜尋名詞或別名"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />

      {status === "loading" && <p className="text-sm text-muted-foreground">載入中…</p>}
      {status === "error" && (
        <p role="alert" className="text-sm text-muted-foreground">
          名詞暫時載入失敗，請稍後再試。
        </p>
      )}
      {status === "ready" && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">找不到符合的名詞。</p>
      )}

      {groups.map((group) => (
        <section key={group.category} aria-labelledby={`${searchId}-${group.category}`}>
          <h2
            id={`${searchId}-${group.category}`}
            className="mb-2 text-sm font-bold text-muted-foreground"
          >
            {CATEGORY_LABELS[group.category]}
          </h2>
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {group.terms.map((term) => (
              <li key={term.id}>
                <TermRow term={term} lens={settings.lens} onOpen={open} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {panel}
    </div>
  );
}

function TermRow({
  term,
  lens,
  onOpen,
}: {
  term: GlossaryTerm;
  lens: Lens;
  onOpen(termId: string): void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(term.id)}
      className="flex w-full flex-col gap-0.5 px-4 py-3 text-left outline-none hover:bg-muted focus-visible:bg-muted"
    >
      <span className="text-base font-medium">{term.term}</span>
      <span className={cn("text-sm text-muted-foreground", lens === "pro" && "line-clamp-2")}>
        {lens === "pro" ? term.pro.definition : term.beginner.plain}
      </span>
    </button>
  );
}
