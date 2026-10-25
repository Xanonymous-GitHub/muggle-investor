"use client";

import { Button } from "@/components/ui/button";
import { ASK_COPY } from "@/ui/ask/copy";
import { ASK_LIMITS } from "@/ui/ask/limits";

type Props = {
  /** What the AI would like remembered. Shown as plain text, whatever characters it has. */
  fact: string;
  /** The memory list is at its maximum: explain instead of offering to save. */
  full?: boolean;
  /** The saved note on the same topic that accepting would replace. */
  replaces?: string;
  /** The only way a note gets written; the caller does the writing. */
  onAccept(): void;
  onDismiss(): void;
};

/** 「要記住嗎？『…』」 with 「記住」 and 「不用」. Rendering it never writes anything. */
export function RememberCard({ fact, full = false, replaces, onAccept, onDismiss }: Props) {
  const tooLong = fact.length > ASK_LIMITS.maxMemoryChars;
  const refusal = full ? ASK_COPY.remember.full : tooLong ? ASK_COPY.remember.tooLong : null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      {refusal === null ? (
        <>
          <p className="break-words">{ASK_COPY.remember.ask(fact)}</p>
          {replaces !== undefined && (
            <p className="break-words text-muted-foreground">
              {ASK_COPY.remember.replaces(replaces)}
            </p>
          )}
        </>
      ) : (
        <p className="break-words">{refusal}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {refusal === null && (
          <Button type="button" className="min-h-11 px-4" onClick={onAccept}>
            {ASK_COPY.remember.accept}
          </Button>
        )}
        <Button type="button" variant="outline" className="min-h-11 px-4" onClick={onDismiss}>
          {ASK_COPY.remember.dismiss}
        </Button>
      </div>
    </section>
  );
}
