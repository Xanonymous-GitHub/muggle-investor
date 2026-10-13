"use client";

import { XIcon } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { GlossaryTerm } from "@/glossary";
import type { Lens } from "@/insight/lens";
import { useSettings } from "@/ui/device/settings-provider";
import { CATEGORY_LABELS } from "@/ui/glossary/search";
import { TermChip } from "@/ui/glossary/term-chip";
import { useMediaQuery } from "@/ui/glossary/use-media-query";

const SOURCE_LABELS: Record<GlossaryTerm["pro"]["source"], string> = {
  darkfanxing: "來源：darkfanxing",
  curated: "來源：自編",
};

type TermPanelProps = {
  term: GlossaryTerm;
  lens: Lens;
  open: boolean;
  onOpenChange(open: boolean): void;
  onOpenRelated(termId: string): void;
};

/** One term, explained in the reader's lens. A bottom sheet on a phone, a side sheet from `md`. */
export function TermPanel({ term, lens, open, onOpenChange, onOpenRelated }: TermPanelProps) {
  const wide = useMediaQuery("(min-width: 768px)");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={wide ? "right" : "bottom"}
        showCloseButton={false}
        className="max-h-[85svh] overflow-y-auto"
      >
        <SheetHeader className="pr-14">
          <SheetTitle className="text-lg">{term.term}</SheetTitle>
          <SheetDescription>{CATEGORY_LABELS[term.category]}名詞</SheetDescription>
        </SheetHeader>
        {/* shadcn's built-in close button has an English-only label, so the panel brings its own. */}
        <SheetClose asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="關閉"
            className="absolute top-3 right-3"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </SheetClose>

        <div className="flex flex-col gap-3 px-4 pb-4 text-sm leading-relaxed">
          {lens === "beginner" ? <BeginnerBody term={term} /> : <ProBody term={term} />}
          {term.related.length > 0 && (
            <section aria-label="相關名詞" className="flex flex-col gap-2 pt-1">
              <h3 className="text-xs font-medium text-muted-foreground">相關名詞</h3>
              <div className="flex flex-wrap gap-2">
                {term.related.map((id) => (
                  <TermChip key={id} termId={id} onOpen={onOpenRelated} />
                ))}
              </div>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BeginnerBody({ term }: { term: GlossaryTerm }) {
  const { plain, analogy, whyItMatters } = term.beginner;
  return (
    <>
      <p className="text-base font-medium">{plain}</p>
      {analogy !== null && <p>{`比喻：${analogy}`}</p>}
      <p className="text-muted-foreground">{whyItMatters}</p>
    </>
  );
}

function ProBody({ term }: { term: GlossaryTerm }) {
  const { definition, formula, source } = term.pro;
  return (
    <>
      <p>{definition}</p>
      {formula !== null && (
        <p className="rounded-md bg-muted px-3 py-2 font-mono text-[0.8125rem]">{formula}</p>
      )}
      <p className="text-xs text-muted-foreground">{SOURCE_LABELS[source]}</p>
    </>
  );
}

/**
 * Lets any screen host one term panel: `open(termId)` shows it, `panel` goes anywhere in the
 * screen's tree. Ids missing from `byId` are ignored. The last term stays mounted while the
 * sheet slides away.
 */
export function useTermPanel(byId: Record<string, GlossaryTerm>): {
  open(termId: string): void;
  panel: ReactNode;
} {
  const { settings } = useSettings();
  const [shown, setShown] = useState<{ termId: string | null; open: boolean }>({
    termId: null,
    open: false,
  });

  const open = useCallback(
    (termId: string) => {
      if (byId[termId]) setShown({ termId, open: true });
    },
    [byId],
  );
  const onOpenChange = useCallback((next: boolean) => setShown((s) => ({ ...s, open: next })), []);

  const term = shown.termId === null ? undefined : byId[shown.termId];
  const panel = term ? (
    <TermPanel
      term={term}
      lens={settings.lens}
      open={shown.open}
      onOpenChange={onOpenChange}
      onOpenRelated={open}
    />
  ) : null;

  return { open, panel };
}
