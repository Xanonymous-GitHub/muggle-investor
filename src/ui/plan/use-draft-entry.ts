"use client";

import { useState } from "react";
import {
  AMOUNT_FIELDS,
  type AmountError,
  type AmountField,
  type DraftValidation,
  type PlanDraft,
  type QuestionId,
  validateDraft,
} from "@/ui/plan/draft";

export type DraftEntry = {
  validation: DraftValidation;
  /** The error to print for a field: only once it was touched or a submit was attempted. */
  amountError(field: AmountField): AmountError | undefined;
  totalError: AmountError | undefined;
  answerMissing(question: QuestionId): boolean;
  touch(field: AmountField): void;
  /** Calls `onDone` for a complete draft; otherwise reveals every error. */
  submit(): void;
};

/** What both questionnaire layouts share: when errors become visible, and the submit rule. */
export function useDraftEntry(draft: PlanDraft, onDone: () => void): DraftEntry {
  const [touched, setTouched] = useState<Partial<Record<AmountField, true>>>({});
  const [submitted, setSubmitted] = useState(false);
  const validation = validateDraft(draft);

  const bothTouched = AMOUNT_FIELDS.slice(0, 2).every((field) => touched[field]);

  return {
    validation,
    amountError: (field) =>
      submitted || touched[field] ? validation.amountErrors[field] : undefined,
    // The total only exists once lump and monthly both parse; wait until both were visited.
    totalError: submitted || bothTouched ? validation.amountErrors.total : undefined,
    answerMissing: (question) => submitted && validation.answersMissing.includes(question),
    touch: (field) => setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true })),
    submit: () => {
      if (validation.complete) onDone();
      else setSubmitted(true);
    },
  };
}
