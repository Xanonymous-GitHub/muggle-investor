"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AskChat } from "@/ui/ask/ask-chat";
import { ASK_COPY } from "@/ui/ask/copy";
import { InviteScreen } from "@/ui/ask/invite-screen";
import { type AskSession, getAskSession } from "@/ui/data/ask-auth";

type Gate = AskSession | "checking";

/** Asks the server whether this browser holds a session, then shows the gate or the chat. */
export function AskScreen() {
  const [gate, setGate] = useState<Gate>("checking");
  // Bumped by the retry button to run the check again.
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the trigger, not a value the effect reads
  useEffect(() => {
    const controller = new AbortController();
    setGate("checking");
    getAskSession(controller.signal).then(setGate, () => {
      // Aborted by unmounting or by a newer check: nothing to show.
    });
    return () => controller.abort();
  }, [attempt]);

  if (gate === "checking") {
    return (
      <div role="status" className="mx-auto flex max-w-3xl flex-col gap-3 pt-2">
        <span className="sr-only">{ASK_COPY.loading}</span>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (gate === "signed_out") return <InviteScreen onSignedIn={() => setGate("signed_in")} />;
  if (gate === "error") {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 pt-8 text-center">
        <p role="alert" className="text-sm text-destructive">
          {ASK_COPY.gate.checkFailed}
        </p>
        <Button type="button" className="min-h-11 px-4" onClick={() => setAttempt((n) => n + 1)}>
          {ASK_COPY.gate.retry}
        </Button>
      </div>
    );
  }
  return <AskChat />;
}
