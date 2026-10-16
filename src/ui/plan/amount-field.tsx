"use client";

import { Input } from "@/components/ui/input";
import { AMOUNT_COPY, AMOUNT_ERROR_COPY, AMOUNT_UNIT } from "@/ui/plan/copy";
import {
  type AmountError,
  type AmountField as Field,
  formatAmount,
  parseAmount,
} from "@/ui/plan/draft";

type Props = {
  id: string;
  field: Field;
  /** The text as typed; the draft keeps text so a half-typed number is never reformatted. */
  value: string;
  /** Pass only once the field may show its error (touched or submitted). */
  error: AmountError | undefined;
  /** The id of a message about this field together with another (lump and monthly both 0). */
  sharedErrorId?: string;
  onChange(text: string): void;
  onBlur(): void;
};

export function AmountField({ id, field, value, error, sharedErrorId, onChange, onBlur }: Props) {
  const { label, hint } = AMOUNT_COPY[field];
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null, sharedErrorId]
    .filter(Boolean)
    .join(" ");

  const handleBlur = () => {
    // Thousands separators go in on leaving the field, and only for text that parses.
    const parsed = parseAmount(value);
    if (parsed.ok) {
      const formatted = formatAmount(parsed.value);
      if (formatted !== value) onChange(formatted);
    }
    onBlur();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={handleBlur}
          aria-invalid={error || sharedErrorId ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="h-11 pr-10 text-right"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
        >
          {AMOUNT_UNIT}
        </span>
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {AMOUNT_ERROR_COPY[error]}
        </p>
      )}
    </div>
  );
}
