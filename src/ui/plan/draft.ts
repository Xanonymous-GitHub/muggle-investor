// The planner form's in-progress state: what the user picked and typed, kept on this device
// only. Amounts stay as typed text so a half-typed "6000" never gets reformatted under the
// cursor; they are parsed (and range-checked) only when the form is validated.
import { QUESTIONS } from "@/planner/rules/questionnaire";
import type { PlanRequest } from "@/planner/schema";
import { readItem, removeItem, writeItem } from "@/ui/device/storage";
import { formatInt } from "@/ui/format";

export type QuestionId = (typeof QUESTIONS)[number]["id"];

export const DRAFT_KEY = "muggle.plan.draft.v1";

export const AMOUNT_FIELDS = ["lump", "monthly", "monthlyExpenses", "existingReserve"] as const;
export type AmountField = (typeof AMOUNT_FIELDS)[number];

export type PlanDraft = {
  answers: Partial<Record<QuestionId, string>>;
  amounts: Record<AmountField, string>;
};

export const EMPTY_DRAFT: PlanDraft = {
  answers: {},
  amounts: { lump: "", monthly: "", monthlyExpenses: "", existingReserve: "" },
};

/** A fresh empty draft; `EMPTY_DRAFT` itself is never handed out, so no consumer can corrupt it. */
export const emptyDraft = (): PlanDraft => ({
  answers: {},
  amounts: { ...EMPTY_DRAFT.amounts },
});

/** Whether `optionId` is one of the options the question lists. */
export function isOptionOf(questionId: QuestionId, optionId: string | undefined): boolean {
  const question = QUESTIONS.find((q) => q.id === questionId);
  return question?.options.some((o) => o.id === optionId) ?? false;
}

/** Mirrors `MAX_AMOUNT` in `@/planner/schema`, which `src/ui` may not import as a value. */
export const MAX_AMOUNT = 1_000_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Tolerant per field: whatever is wrong with one stored value never costs the rest.
export function parseDraft(raw: string | null): PlanDraft {
  if (raw === null) return emptyDraft();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyDraft();
  }
  if (!isRecord(parsed)) return emptyDraft();

  const answers: PlanDraft["answers"] = {};
  const storedAnswers = isRecord(parsed.answers) ? parsed.answers : {};
  for (const question of QUESTIONS) {
    const picked = storedAnswers[question.id];
    if (typeof picked === "string" && isOptionOf(question.id, picked)) {
      answers[question.id] = picked;
    }
  }

  const { amounts } = emptyDraft();
  const storedAmounts = isRecord(parsed.amounts) ? parsed.amounts : {};
  for (const field of AMOUNT_FIELDS) {
    const typed = storedAmounts[field];
    if (typeof typed === "string") amounts[field] = typed;
  }
  return { answers, amounts };
}

export function serializeDraft(draft: PlanDraft): string {
  return JSON.stringify({ answers: draft.answers, amounts: draft.amounts });
}

export function readDraft(): PlanDraft {
  return parseDraft(readItem(DRAFT_KEY));
}

/** False when the draft could not be saved (storage blocked or full). */
export function writeDraft(draft: PlanDraft): boolean {
  return writeItem(DRAFT_KEY, serializeDraft(draft));
}

/** Forgets the saved draft on this device; nothing else was ever stored. */
export function clearDraft(): void {
  removeItem(DRAFT_KEY);
}

/** Whether there is nothing to forget: no answer picked and no amount text typed. */
export function isEmptyDraft(draft: PlanDraft): boolean {
  return (
    Object.keys(draft.answers).length === 0 &&
    AMOUNT_FIELDS.every((field) => draft.amounts[field] === "")
  );
}

export type AmountFailure = "empty" | "not_integer" | "too_large";
export type AmountResult = { ok: true; value: number } | { ok: false; reason: AmountFailure };

/** Whole TWD from what the user typed: digits with optional `,` separators, full-width allowed. */
export function parseAmount(text: string): AmountResult {
  // NFKC folds full-width digits and the full-width comma to their ASCII forms.
  const normalized = text.normalize("NFKC").trim();
  if (normalized === "") return { ok: false, reason: "empty" };
  if (!/^\d+(?:,\d+)*$/.test(normalized)) return { ok: false, reason: "not_integer" };
  const value = Number(normalized.replaceAll(",", ""));
  if (value > MAX_AMOUNT) return { ok: false, reason: "too_large" };
  return { ok: true, value };
}

export function formatAmount(value: number): string {
  return formatInt(value);
}

export type AmountError = AmountFailure | "zero";

export type DraftValidation = {
  complete: boolean;
  answersMissing: QuestionId[];
  amountErrors: Partial<Record<AmountField | "total", AmountError>>;
};

export function validateDraft(draft: PlanDraft): DraftValidation {
  const answersMissing = QUESTIONS.filter((q) => !isOptionOf(q.id, draft.answers[q.id])).map(
    (q) => q.id,
  );

  const amountErrors: DraftValidation["amountErrors"] = {};
  const values: Partial<Record<AmountField, number>> = {};
  for (const field of AMOUNT_FIELDS) {
    const result = parseAmount(draft.amounts[field]);
    if (result.ok) values[field] = result.value;
    else amountErrors[field] = result.reason;
  }
  if (
    values.lump !== undefined &&
    values.monthly !== undefined &&
    values.lump + values.monthly === 0
  ) {
    amountErrors.total = "zero";
  }

  const complete = answersMissing.length === 0 && Object.keys(amountErrors).length === 0;
  return { complete, answersMissing, amountErrors };
}

/** The request to send, or null while the draft is incomplete or invalid. */
export function toRequest(draft: PlanDraft): PlanRequest | null {
  if (!validateDraft(draft).complete) return null;
  const { age, horizon, income, reserve, loss } = draft.answers;
  const amount = (field: AmountField): number => {
    const result = parseAmount(draft.amounts[field]);
    return result.ok ? result.value : 0;
  };
  // `complete` guarantees every answer is present, but TypeScript cannot see that.
  if (!(age && horizon && income && reserve && loss)) return null;
  return {
    // `validateDraft` checked every id against QUESTIONS; the schema re-checks.
    answers: { age, horizon, income, reserve, loss } as PlanRequest["answers"],
    lump: amount("lump"),
    monthly: amount("monthly"),
    monthlyExpenses: amount("monthlyExpenses"),
    existingReserve: amount("existingReserve"),
  };
}
