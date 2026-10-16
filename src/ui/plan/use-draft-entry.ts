"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
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
  /**
   * Put on the layout's root element: after a failed submit, focus goes to the first invalid
   * control inside it, in DOM order.
   */
  rootRef: RefObject<HTMLDivElement | null>;
  /** Calls `onDone` for a complete draft; otherwise reveals every error and focuses the first. */
  submit(): void;
};

/** What `aria-invalid` is set on: an amount input, or a radiogroup with no answer. */
const INVALID = '[aria-invalid="true"]';

/** What both questionnaire layouts share: when errors become visible, and the submit rule. */
export function useDraftEntry(draft: PlanDraft, onDone: () => void): DraftEntry {
  const [touched, setTouched] = useState<Partial<Record<AmountField, true>>>({});
  const [submitted, setSubmitted] = useState(false);
  // Counts failed submits; each one moves focus once the errors it reveals are on screen.
  const [failedSubmits, setFailedSubmits] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const validation = validateDraft(draft);

  useEffect(() => {
    if (failedSubmits === 0) return;
    const invalid = rootRef.current?.querySelector<HTMLElement>(INVALID);
    // A radiogroup is not itself focusable: its first radio is the way in.
    const target =
      invalid?.getAttribute("role") === "radiogroup"
        ? invalid.querySelector<HTMLElement>('[role="radio"]')
        : invalid;
    target?.focus();
  }, [failedSubmits]);

  const bothTouched = AMOUNT_FIELDS.slice(0, 2).every((field) => touched[field]);

  return {
    validation,
    amountError: (field) =>
      submitted || touched[field] ? validation.amountErrors[field] : undefined,
    // The total only exists once lump and monthly both parse; wait until both were visited.
    totalError: submitted || bothTouched ? validation.amountErrors.total : undefined,
    answerMissing: (question) => submitted && validation.answersMissing.includes(question),
    touch: (field) => setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true })),
    rootRef,
    submit: () => {
      if (validation.complete) {
        onDone();
        return;
      }
      setSubmitted(true);
      setFailedSubmits((count) => count + 1);
    },
  };
}
