"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { AmountField } from "@/ui/plan/amount-field";
import { AMOUNT_ERROR_COPY, FORM_COPY, PRIVACY_LINE } from "@/ui/plan/copy";
import { AMOUNT_FIELDS, type PlanDraft } from "@/ui/plan/draft";
import type { DraftEntry } from "@/ui/plan/use-draft-entry";

type Props = {
  draft: PlanDraft;
  onChange(draft: PlanDraft): void;
  entry: DraftEntry;
};

/** The four amount fields, with the "lump + monthly must not both be 0" error under them. */
export function AmountsSection({ draft, onChange, entry }: Props) {
  const uid = useId();
  return (
    <div className="flex flex-col gap-4">
      {AMOUNT_FIELDS.map((field) => (
        <AmountField
          key={field}
          id={`${uid}-${field}`}
          field={field}
          value={draft.amounts[field]}
          error={entry.amountError(field)}
          onChange={(text) => onChange({ ...draft, amounts: { ...draft.amounts, [field]: text } })}
          onBlur={() => entry.touch(field)}
        />
      ))}
      {entry.totalError && (
        <p role="alert" className="text-sm text-destructive">
          {AMOUNT_ERROR_COPY[entry.totalError]}
        </p>
      )}
    </div>
  );
}

/** The primary button and the privacy line, shared by both layouts. */
export function SubmitBlock({ entry }: { entry: DraftEntry }) {
  return (
    <div className="flex flex-col gap-3">
      <Button type="button" className="h-12 w-full text-base" onClick={entry.submit}>
        {FORM_COPY.submit}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{PRIVACY_LINE}</p>
    </div>
  );
}
