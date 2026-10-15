"use client";

import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import type { QuestionId } from "@/ui/plan/draft";

type Props = {
  questionId: QuestionId;
  value: string | undefined;
  /** The group's accessible name (the prompt's element id). */
  labelledBy: string;
  describedBy?: string;
  /** Called with the picked option; also when the already chosen option is tapped again. */
  onSelect(optionId: string): void;
  variant: "rows" | "segments";
};

const ROW =
  "relative flex min-h-12 items-center justify-between gap-3 rounded-xl border bg-card px-4 has-[[aria-checked=true]]:border-primary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50";
const SEGMENT =
  "relative flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50";
// The label's overlay makes the whole box the tap target.
const OVERLAY = "after:absolute after:inset-0 after:content-['']";
const ROW_LABEL = `flex-1 py-3 text-base font-medium ${OVERLAY}`;
const SEGMENT_LABEL = `text-sm font-medium ${OVERLAY}`;

/**
 * One question's options as a radio group: full-width rows for the one-per-page layout, wrapping
 * boxes for the single-page layout. The options are the scorer's own, in its order.
 */
export function QuestionOptions({
  questionId,
  value,
  labelledBy,
  describedBy,
  onSelect,
  variant,
}: Props) {
  const uid = useId();
  const question = QUESTIONS.find((q) => q.id === questionId);
  if (!question) return null;
  const rows = variant === "rows";

  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      // Controlled even when nothing is chosen: "" matches no option.
      value={value ?? ""}
      onValueChange={onSelect}
      className={rows ? "gap-2" : "flex flex-wrap gap-2"}
    >
      {question.options.map((option) => {
        const itemId = `${uid}-${option.id}`;
        return (
          <div key={option.id} className={rows ? ROW : SEGMENT}>
            <label htmlFor={itemId} className={rows ? ROW_LABEL : SEGMENT_LABEL}>
              {option.label}
            </label>
            <RadioGroupItem
              id={itemId}
              value={option.id}
              // A change event never fires for the option that is already chosen.
              onClick={() => {
                if (value === option.id) onSelect(option.id);
              }}
              className={rows ? "order-last size-6" : "order-first"}
            />
          </div>
        );
      })}
    </RadioGroup>
  );
}
