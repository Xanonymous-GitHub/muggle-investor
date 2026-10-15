"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import { AmountsSection, SubmitBlock } from "@/ui/plan/amounts-section";
import { FORM_COPY, QUESTION_COPY, stepLabel } from "@/ui/plan/copy";
import type { PlanDraft } from "@/ui/plan/draft";
import { isOptionOf } from "@/ui/plan/draft";
import { QuestionOptions } from "@/ui/plan/question-options";
import { useDraftEntry } from "@/ui/plan/use-draft-entry";

type Props = {
  draft: PlanDraft;
  onChange(draft: PlanDraft): void;
  onDone(): void;
};

// Five questions, then the amounts.
const STEPS = QUESTIONS.length + 1;

function firstOpenStep(draft: PlanDraft): number {
  const open = QUESTIONS.findIndex((q) => !isOptionOf(q.id, draft.answers[q.id]));
  return open === -1 ? QUESTIONS.length : open;
}

/** The phone layout: one question per page, choosing advances, the last page holds the amounts. */
export function QuestionnaireWizard({ draft, onChange, onDone }: Props) {
  const uid = useId();
  // Open where the person left off (for a stored draft, the first question still unanswered).
  const [step, setStep] = useState(() => firstOpenStep(draft));
  const entry = useDraftEntry(draft, onDone);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);

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
          onClick={() => setStep(step - 1)}
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
            onSelect={(optionId) => {
              onChange({ ...draft, answers: { ...draft.answers, [question.id]: optionId } });
              setStep(step + 1);
            }}
          />
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
