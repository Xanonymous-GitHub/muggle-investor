"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import { AmountsSection, SubmitBlock } from "@/ui/plan/amounts-section";
import { FORM_COPY, QUESTION_COPY, stepLabel } from "@/ui/plan/copy";
import { isOptionOf, type PlanDraft, type QuestionId } from "@/ui/plan/draft";
import { QuestionOptions } from "@/ui/plan/question-options";
import { useDraftEntry } from "@/ui/plan/use-draft-entry";

type Props = {
  draft: PlanDraft;
  onChange(draft: PlanDraft): void;
  onDone(): void;
  /**
   * Where to open: the first unanswered question (a reload), or question 1 (coming back from the
   * result to change any answer).
   */
  startAt: "first-open" | "first";
};

/** A tap this soon after a step change is the tail of a double-tap, not a new choice. */
const TAP_GUARD_MS = 300;

// Five questions, then the amounts.
const STEPS = QUESTIONS.length + 1;

function firstOpenStep(draft: PlanDraft): number {
  const open = QUESTIONS.findIndex((q) => !isOptionOf(q.id, draft.answers[q.id]));
  return open === -1 ? QUESTIONS.length : open;
}

/** The phone layout: one question per page, choosing advances, the last page holds the amounts. */
export function QuestionnaireWizard({ draft, onChange, onDone, startAt }: Props) {
  const uid = useId();
  // Open where the person left off (for a stored draft, the first question still unanswered).
  const [step, setStep] = useState(() => (startAt === "first" ? 0 : firstOpenStep(draft)));
  const entry = useDraftEntry(draft, onDone);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  const lastStepChange = useRef(Number.NEGATIVE_INFINITY);

  const goTo = (next: number) => {
    lastStepChange.current = Date.now();
    setStep(next);
  };
  const choose = (questionId: QuestionId, optionId: string) =>
    onChange({ ...draft, answers: { ...draft.answers, [questionId]: optionId } });

  // After a step change keyboard and screen-reader users land on the new heading.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  const question = QUESTIONS[step];
  const promptId = `${uid}-prompt`;
  const hintId = `${uid}-hint`;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
      <div
        role="progressbar"
        aria-label={stepLabel(step + 1, STEPS)}
        aria-valuemin={1}
        aria-valuemax={STEPS}
        aria-valuenow={step + 1}
        className="flex gap-1.5"
      >
        {Array.from({ length: STEPS }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, order never changes
            key={index}
            className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>

      {step > 0 && (
        <Button
          type="button"
          variant="ghost"
          className="h-11 self-start px-3"
          onClick={() => goTo(step - 1)}
        >
          <ChevronLeft aria-hidden="true" />
          {FORM_COPY.back}
        </Button>
      )}

      {question ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2
              id={promptId}
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-semibold outline-none"
            >
              {QUESTION_COPY[question.id].prompt}
            </h2>
            {QUESTION_COPY[question.id].hint && (
              <p id={hintId} className="text-sm text-muted-foreground">
                {QUESTION_COPY[question.id].hint}
              </p>
            )}
          </div>
          <QuestionOptions
            key={question.id}
            variant="rows"
            questionId={question.id}
            value={draft.answers[question.id]}
            labelledBy={promptId}
            describedBy={QUESTION_COPY[question.id].hint ? hintId : undefined}
            // Arrow keys and Space only choose; the keyboard moves on with 下一步.
            onSelect={(optionId) => choose(question.id, optionId)}
            onPointerPick={(optionId) => {
              if (Date.now() - lastStepChange.current < TAP_GUARD_MS) return;
              choose(question.id, optionId);
              goTo(step + 1);
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full text-base"
            disabled={!isOptionOf(question.id, draft.answers[question.id])}
            onClick={() => goTo(step + 1)}
          >
            {FORM_COPY.next}
          </Button>
        </section>
      ) : (
        <section className="flex flex-col gap-5">
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
            {FORM_COPY.amountsTitle}
          </h2>
          <AmountsSection draft={draft} onChange={onChange} entry={entry} />
          <SubmitBlock entry={entry} />
        </section>
      )}
    </div>
  );
}
