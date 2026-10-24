"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { splitRememberLine, toolLabel } from "@/ui/ask/answer";
import { AnswerView } from "@/ui/ask/answer-view";
import { ASK_COPY } from "@/ui/ask/copy";
import { ASK_LIMITS } from "@/ui/ask/limits";
import { RememberCard } from "@/ui/ask/remember-card";
import { normalizeNote, readMemory } from "@/ui/ask/stores";
import type { LinkableTerm } from "@/ui/ask/term-linker";
import type { Turn } from "@/ui/ask/use-ask-chat";
import { verificationNotes } from "@/ui/ask/verification";

/** What became of a 記住 press: stored, refused because the list is full, or storage failed. */
export type RememberResult = "saved" | "full" | "failed";

type Decision = RememberResult | "dismissed";

type Props = {
  turn: Turn;
  lens: "beginner" | "pro";
  terms: readonly LinkableTerm[];
  onOpenTerm(termId: string): void;
  /** The person pressed 記住. Returns whether the note is now stored, or why not. */
  onRemember(note: string): RememberResult;
  /** Ask the same question again; offered on a broken answer when given. */
  onRetry?(): void;
};

const NOTICE_TONE = {
  no_web: "bg-muted text-foreground",
  no_tools: "bg-muted text-foreground",
  tool_failed: "bg-warn text-warn-foreground",
  timeout: "bg-warn text-warn-foreground",
} as const;

/** The question, right-aligned, as plain text. */
export function UserMessage({ turn }: { turn: Turn }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-primary-foreground">
        {turn.text}
      </p>
    </div>
  );
}

const unique = (names: readonly string[]) => [...new Set(names)].join("、");

/** One shared empty list, so an answer without a verification keeps `AnswerView`'s props equal. */
const NONE: readonly string[] = [];

/**
 * One AI answer: its notices, the lookup status, the text, the number-check footnotes, an offer
 * to remember something, and (only once it finished) the fixed sentence. "Finished" means not
 * streaming, not broken off, not stopped by the person, and with text; a broken or stopped answer
 * gets neither the sentence nor a remember card.
 */
export function AssistantMessage({ turn, lens, terms, onOpenTerm, onRemember, onRetry }: Props) {
  // What happened to this answer's remember offer; kept here, so it lives as long as the answer.
  const [decision, setDecision] = useState<Decision | null>(null);
  const finished = !turn.streaming && !turn.failed && !turn.stopped && turn.text !== "";
  const split = splitRememberLine(turn.text);
  // The strict last line never shows as body text, whatever became of the answer.
  const body = split.body;
  // Offered only for an answer received in this page session: after a reload the question of
  // whether to remember it was already put (and may have been declined).
  // Not offered either when the server found no support for it in the user's own words.
  const fact =
    finished && turn.restored !== true && turn.verification?.rememberSupported !== false
      ? split.remember
      : null;

  const running = turn.streaming ? turn.tools.filter((tool) => !tool.done) : [];
  const toolLine =
    running.length > 0
      ? ASK_COPY.chat.toolRunning(unique(running.map((tool) => toolLabel(tool.name))))
      : turn.tools.length > 0
        ? ASK_COPY.chat.toolUsed(unique(turn.tools.map((tool) => toolLabel(tool.name))))
        : null;

  const unsupported = turn.verification?.unsupported ?? NONE;
  const notes = turn.verification === null ? NONE : verificationNotes(turn.verification);

  return (
    <article className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">{ASK_COPY.chat.aiLabel}</p>

      {turn.notices.map((notice, index) => (
        <p
          // A notice has no id and may repeat its kind; order is its identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          role="status"
          className={cn("rounded-lg px-3 py-2 text-sm", NOTICE_TONE[notice.kind])}
        >
          {notice.text}
        </p>
      ))}

      {toolLine !== null && <p className="text-xs text-muted-foreground">{toolLine}</p>}

      {body !== "" ? (
        <AnswerView
          text={body}
          lens={lens}
          unsupported={unsupported}
          terms={terms}
          onOpenTerm={onOpenTerm}
        />
      ) : (
        turn.streaming && (
          <div className="flex flex-col gap-2">
            <span className="sr-only">{ASK_COPY.chat.thinking}</span>
            <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
          </div>
        )
      )}

      {turn.failed && (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p role="alert" className="text-destructive">
            {ASK_COPY.chat.failedTurn}
          </p>
          {onRetry !== undefined && (
            <Button type="button" variant="outline" className="min-h-11 px-4" onClick={onRetry}>
              {ASK_COPY.chat.retry}
            </Button>
          )}
        </div>
      )}
      {turn.stopped && <p className="text-sm text-muted-foreground">{ASK_COPY.chat.stoppedTurn}</p>}

      {notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}

      {fact !== null && (
        <RememberOffer
          fact={fact}
          decision={decision}
          onAccept={() => setDecision(onRemember(fact))}
          onDismiss={() => setDecision("dismissed")}
        />
      )}

      {finished && <p className="text-xs text-muted-foreground">{ASK_COPY.chat.verdict}</p>}
    </article>
  );
}

function RememberOffer({
  fact,
  decision,
  onAccept,
  onDismiss,
}: {
  fact: string;
  decision: Decision | null;
  onAccept(): void;
  onDismiss(): void;
}) {
  if (decision === "saved") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {ASK_COPY.remember.saved}
      </p>
    );
  }
  if (decision === "full") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {ASK_COPY.remember.full}
      </p>
    );
  }
  if (decision === "failed") {
    return (
      <p role="status" className="text-sm text-destructive">
        {ASK_COPY.remember.failed}
      </p>
    );
  }
  if (decision === "dismissed") return null;
  // Read at render, so a note saved or deleted elsewhere (the data sheet) is honoured.
  const notes = readMemory();
  if (notes.includes(normalizeNote(fact))) return null;
  return (
    <RememberCard
      fact={fact}
      full={notes.length >= ASK_LIMITS.maxMemoryNotes}
      onAccept={onAccept}
      onDismiss={onDismiss}
    />
  );
}
