"use client";

import { useId } from "react";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import { AmountsSection, SubmitBlock } from "@/ui/plan/amounts-section";
import { ANSWER_MISSING, FORM_COPY, QUESTION_COPY } from "@/ui/plan/copy";
import type { PlanDraft } from "@/ui/plan/draft";
import { QuestionOptions } from "@/ui/plan/question-options";
import { useDraftEntry } from "@/ui/plan/use-draft-entry";

type Props = {
  draft: PlanDraft;
  onChange(draft: PlanDraft): void;
  onDone(): void;
};

/** The wide-screen layout: every input on one page, questions left and amounts right. */
export function QuestionnaireForm({ draft, onChange, onDone }: Props) {
  const uid = useId();
  const entry = useDraftEntry(draft, onDone);

  return (
    <div className="grid gap-8 rounded-xl border bg-card p-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className="flex flex-col gap-6">
        <h2 className="text-base font-bold">{FORM_COPY.questionsTitle}</h2>
        {QUESTIONS.map((question) => {
          const { prompt, hint } = QUESTION_COPY[question.id];
          const promptId = `${uid}-${question.id}-prompt`;
          const hintId = `${uid}-${question.id}-hint`;
          const missingId = `${uid}-${question.id}-missing`;
          const missing = entry.answerMissing(question.id);
          const describedBy = [hint ? hintId : null, missing ? missingId : null]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={question.id} className="flex flex-col gap-2">
              <h3 id={promptId} className="text-sm font-semibold">
                {prompt}
              </h3>
              {hint && (
                <p id={hintId} className="text-xs text-muted-foreground">
                  {hint}
                </p>
              )}
              <QuestionOptions
                variant="segments"
                questionId={question.id}
                value={draft.answers[question.id]}
                labelledBy={promptId}
                describedBy={describedBy || undefined}
                onSelect={(optionId) =>
                  onChange({ ...draft, answers: { ...draft.answers, [question.id]: optionId } })
                }
              />
              {missing && (
                <p id={missingId} className="text-sm text-destructive">
                  {ANSWER_MISSING}
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-5 md:self-start">
        <h2 className="text-base font-bold">{FORM_COPY.amountsTitle}</h2>
        <AmountsSection draft={draft} onChange={onChange} entry={entry} />
        <SubmitBlock entry={entry} />
      </section>
    </div>
  );
}
