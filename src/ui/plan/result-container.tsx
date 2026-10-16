"use client";

import { Component, lazy, type ReactNode, Suspense, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { GlossaryTerm } from "@/glossary";
import type { Lens } from "@/insight/lens";
import type { PlanRequest } from "@/planner/schema";
import { type PlanExplanationJson, planExplanationUrl } from "@/ui/data/api";
import { useResource } from "@/ui/data/use-resource";
import { useTermPanel } from "@/ui/glossary/term-panel";
import { useGlossary } from "@/ui/glossary/use-glossary";
import { FORM_COPY, RESULT_COPY } from "@/ui/plan/copy";
import { ExplanationCard } from "@/ui/plan/explanation-card";
import { ResultView } from "@/ui/plan/result-view";
import { type PlanErrorKind, usePlan } from "@/ui/plan/use-plan";

// The chart library is large and only the result needs it, so the history loads on its own.
const loadHistory = () => import("@/ui/plan/history-card");
const HistoryCard = lazy(() => loadHistory().then((m) => ({ default: m.HistoryCard })));

const NO_TERMS: Record<string, GlossaryTerm> = {};

type Props = {
  request: PlanRequest;
  lens: Lens;
  /** Back to the questionnaire; the saved answers are not touched here. */
  onEdit(): void;
};

/**
 * Sends the request, then shows what came back: the result, or why there is none. The lens is
 * not part of the request, so switching it re-labels the result without asking again.
 */
export function ResultContainer({ request, lens, onEdit }: Props) {
  const plan = usePlan(request);
  // Fetch the history code while the plan is on its way instead of after it arrived.
  useEffect(() => {
    loadHistory().catch(() => {
      // The card's own boundary says so when it is needed and the code is not there.
    });
  }, []);
  const glossary = useGlossary();
  const level = plan.status === "ready" ? plan.plan.profile.level : null;
  // Read once: the card shows it and the term panel takes its terms.
  const explanation = useResource<PlanExplanationJson>(
    level === null ? null : planExplanationUrl(level, lens),
  );
  const terms = explanation.status === "ready" ? explanation.data.terms : NO_TERMS;
  const byId = useMemo(() => ({ ...glossary.byId, ...terms }), [glossary.byId, terms]);
  const { open, panel } = useTermPanel(byId);

  const editButton = (
    <Button type="button" variant="outline" className="min-h-11 px-4" onClick={onEdit}>
      {FORM_COPY.editAnswers}
    </Button>
  );

  if (plan.status === "idle" || plan.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex">{editButton}</div>
        <ResultSkeleton />
      </div>
    );
  }
  if (plan.status === "error") {
    return <ResultError kind={plan.kind} onRetry={plan.retry} edit={editButton} />;
  }

  const result = plan.plan;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex">{editButton}</div>
      <ResultView
        plan={result}
        request={request}
        lens={lens}
        explanation={<ExplanationCard resource={explanation} onOpenTerm={open} />}
        history={
          result.kind === "plan" ? (
            <HistoryBoundary>
              <Suspense fallback={<HistorySkeleton />}>
                <HistoryCard plan={result} lens={lens} />
              </Suspense>
            </HistoryBoundary>
          ) : null
        }
      />
      {panel}
    </div>
  );
}

function ResultError({
  kind,
  onRetry,
  edit,
}: {
  kind: PlanErrorKind;
  onRetry(): void;
  edit: ReactNode;
}) {
  const { message, retry } = RESULT_COPY.errors[kind];
  return (
    <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
      <p role="alert" className="text-base font-bold">
        {message}
      </p>
      <p className="text-sm text-muted-foreground">{RESULT_COPY.savedNote}</p>
      <div className="flex flex-wrap gap-2">
        {retry === null ? null : (
          <Button type="button" className="min-h-11 px-4" onClick={onRetry}>
            {retry}
          </Button>
        )}
        {edit}
      </div>
    </section>
  );
}

/** Shaped like the result: the profile, the allocation and the rhythm. */
function ResultSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={RESULT_COPY.loading}
      className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start"
    >
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:col-start-2 lg:row-start-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-2.5 w-full rounded-full" />
      </div>
      <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-full rounded-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </div>
  );
}

/** Stands in for the history card while its code loads. */
function HistorySkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={RESULT_COPY.historyLoading}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** The history code failed to load: say so quietly and leave the rest of the result alone. */
class HistoryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        {RESULT_COPY.historyFailed}
      </p>
    );
  }
}
