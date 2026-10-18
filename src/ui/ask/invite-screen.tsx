"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASK_COPY } from "@/ui/ask/copy";
import { type InviteResult, postInvite } from "@/ui/data/ask-auth";

const FAILURES: Record<Exclude<InviteResult, "ok">, string> = {
  invalid: ASK_COPY.invite.invalid,
  throttled: ASK_COPY.invite.throttled,
  error: ASK_COPY.invite.error,
};

/** The invite-code gate. The code lives in this component's state only, never on the device. */
export function InviteScreen({ onSignedIn }: { onSignedIn(): void }) {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Exclude<InviteResult, "ok"> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set synchronously, so a double click cannot start a second request before `sending` renders.
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => () => controller.current?.abort(), []);

  // The backend compares the code exactly, so a pasted trailing space or newline would fail.
  const trimmed = code.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || trimmed === "") return;
    busy.current = true;
    setSending(true);
    setFailure(null);
    const own = new AbortController();
    controller.current = own;
    let result: InviteResult;
    try {
      result = await postInvite(trimmed, own.signal);
    } catch {
      // Aborted by unmounting: nothing left to update.
      return;
    }
    if (result === "ok") {
      onSignedIn();
      return;
    }
    busy.current = false;
    setSending(false);
    setFailure(result);
    // Keep the person where they type; the alert is announced by its role.
    inputRef.current?.focus();
  };

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-sm flex-col gap-4 pt-6">
      <h1 className="text-xl font-bold">{ASK_COPY.invite.heading}</h1>
      <p className="text-sm text-muted-foreground">{ASK_COPY.invite.intro}</p>
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          {ASK_COPY.invite.label}
        </label>
        <Input
          id={inputId}
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={code}
          aria-invalid={failure === "invalid" ? true : undefined}
          aria-describedby={failure ? errorId : undefined}
          className="min-h-11"
          onChange={(event) => {
            setCode(event.target.value);
            setFailure(null);
          }}
        />
      </div>
      {failure ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {FAILURES[failure]}
        </p>
      ) : null}
      <Button type="submit" className="min-h-11" disabled={sending || trimmed === ""}>
        {ASK_COPY.invite.submit}
      </Button>
    </form>
  );
}
