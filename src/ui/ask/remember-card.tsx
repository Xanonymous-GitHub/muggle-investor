"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASK_COPY } from "@/ui/ask/copy";
import { isNoteTooLong, normalizeNote } from "@/ui/ask/stores";

type Props = {
  /** What the AI would like remembered. Shown as plain text, whatever characters it has. */
  fact: string;
  /** The saved note on the same topic that saving this text would replace, if any. */
  replaceOf(note: string): string | undefined;
  /** The memory list is at its maximum and saving this text would not replace anything. */
  isFull(note: string): boolean;
  /** The only way a note gets written; the caller does the writing, with the text as corrected. */
  onAccept(note: string): void;
  onDismiss(): void;
};

/**
 * 「要記住嗎？『…』」 with 「記住」, 「修改」 and 「不用」. The person can correct the wording before
 * saving it; what is saved is exactly what the box shows, cleaned up to one line. Rendering it
 * never writes anything.
 */
export function RememberCard({ fact, replaceOf, isFull, onAccept, onDismiss }: Props) {
  const [text, setText] = useState(fact);
  const [editing, setEditing] = useState(false);
  const inputId = useId();
  const note = normalizeNote(text);
  const tooLong = isNoteTooLong(text);
  const replaces = note === "" ? undefined : replaceOf(note);
  const refusal = isFull(note)
    ? ASK_COPY.remember.full
    : tooLong
      ? ASK_COPY.remember.tooLong
      : null;
  const empty = note === "";
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-sm leading-6">
      {editing ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="text-muted-foreground">
            {ASK_COPY.remember.editLabel}
          </label>
          <Input
            id={inputId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-11 text-base md:text-base"
          />
          {empty && <p className="text-destructive">{ASK_COPY.remember.needText}</p>}
        </div>
      ) : (
        refusal === null && <p className="break-words">{ASK_COPY.remember.ask(text)}</p>
      )}
      {refusal !== null && <p className="break-words">{refusal}</p>}
      {replaces !== undefined && refusal === null && (
        <p className="break-words text-muted-foreground">{ASK_COPY.remember.replaces(replaces)}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {refusal === null && (
          <Button
            type="button"
            className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
            disabled={empty}
            onClick={() => onAccept(note)}
          >
            {ASK_COPY.remember.accept}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
          aria-pressed={editing}
          onClick={() => setEditing((on) => !on)}
        >
          {ASK_COPY.remember.edit}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
          onClick={onDismiss}
        >
          {ASK_COPY.remember.dismiss}
        </Button>
      </div>
    </section>
  );
}
