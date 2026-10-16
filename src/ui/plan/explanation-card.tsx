"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Lens } from "@/insight/lens";
import { type PlanExplanationJson, planExplanationUrl } from "@/ui/data/api";
import { useResource } from "@/ui/data/use-resource";
import { TermChip } from "@/ui/glossary/term-chip";
import { EXPLANATION_COPY } from "@/ui/plan/copy";

type Props = {
  level: 1 | 2 | 3 | 4 | 5;
  lens: Lens;
  onOpenTerm(termId: string): void;
};

const CARD_CLASS = "flex flex-col gap-3 rounded-xl border bg-card p-4";

/**
 * The AI's words about a level, read from the stored explanation for the level and lens. It
 * never holds the reader's amounts: it is the same text for everyone at this level. Missing is
 * quiet (it is written on a schedule); an unreadable one offers a single reload.
 */
export function ExplanationCard({ level, lens, onOpenTerm }: Props) {
  const resource = useResource<PlanExplanationJson>(planExplanationUrl(level, lens));
  if (resource.status === "idle" || resource.status === "loading") {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={EXPLANATION_COPY.loading}
        className={CARD_CLASS}
      >
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (resource.status === "error") {
    if (resource.kind === "not_found") {
      return <p className="px-1 text-sm text-muted-foreground">{EXPLANATION_COPY.missing}</p>;
    }
    return (
      <div className="flex items-center justify-between gap-2 px-1 text-sm text-muted-foreground">
        <span>{EXPLANATION_COPY.failed}</span>
        <Button variant="outline" className="min-h-11 px-3" onClick={resource.reload}>
          {EXPLANATION_COPY.reload}
        </Button>
      </div>
    );
  }
  return <ExplanationBody explanation={resource.data.explanation} onOpenTerm={onOpenTerm} />;
}

function ExplanationBody({
  explanation,
  onOpenTerm,
}: {
  explanation: PlanExplanationJson["explanation"];
  onOpenTerm(termId: string): void;
}) {
  const headingId = useId();
  const { content } = explanation;
  // The LLM may list a term twice; one chip each.
  const termIds = [...new Set(content.termIds)];
  return (
    <section aria-labelledby={headingId} className={CARD_CLASS}>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          {EXPLANATION_COPY.dated(explanation.periodKey)}
        </p>
        <h2 id={headingId} className="text-lg leading-snug font-extrabold text-balance">
          {content.headline}
        </h2>
      </div>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">
        <p className="text-base">{content.summary}</p>
        <div className="grid gap-2">
          {content.sections.map((section, i) => (
            // Titles come from the LLM and may repeat; the order is fixed, so the index is stable.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            <section key={i} className="rounded-lg bg-muted px-3 py-2.5">
              <h3 className="mb-0.5 font-bold">{section.title}</h3>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
        <p className="text-muted-foreground">{content.takeaway}</p>
        {termIds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {termIds.map((id) => (
              <TermChip key={id} termId={id} onOpen={onOpenTerm} />
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{EXPLANATION_COPY.aiNote}</p>
    </section>
  );
}
