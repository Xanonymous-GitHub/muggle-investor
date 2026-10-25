"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  ClockIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { splitRememberLine, toolLabel } from "@/ui/ask/answer";
import { AnswerView } from "@/ui/ask/answer-view";
import { contextLine } from "@/ui/ask/context-text";
import { ASK_COPY } from "@/ui/ask/copy";
import { INSPECTOR_ID } from "@/ui/ask/evidence-inspector";
import { ASK_LIMITS } from "@/ui/ask/limits";
import { replacementCandidate } from "@/ui/ask/memory-notes";
import { countTools, evidenceStatusOf, isComplete, type Phase, phaseOf } from "@/ui/ask/phase";
import { RememberCard } from "@/ui/ask/remember-card";
import { normalizeNote, readMemoryNotes } from "@/ui/ask/stores";
import type { LinkableTerm } from "@/ui/ask/term-linker";
import type { Turn } from "@/ui/ask/use-ask-chat";
import { evidenceNotes, verificationWarnings } from "@/ui/ask/verification";

/** What became of a 記住 press: stored, refused because the list is full, or storage failed. */
export type RememberResult = "saved" | "full" | "failed";

type Decision = RememberResult | "dismissed";

/** How the retry of this answer works: whether its first settings still exist, and whether they differ from now. */
export type RetryOffer = {
  /** The request this question first went out with is still held (not after a reload). */
  hasOriginal: boolean;
  /** The lens or the personal context differs from what that request had. */
  changed: boolean;
  run(mode: "original" | "current"): void;
};

type Props = {
  turn: Turn;
  lens: "beginner" | "pro";
  terms: readonly LinkableTerm[];
  onOpenTerm(termId: string): void;
  /** The person pressed 記住. Returns whether the note is now stored, or why not. */
  onRemember(note: string): RememberResult;
  /** Asking again; offered on an answer that broke off or ran out of time, when given. */
  retry?: RetryOffer;
  /** A source chip was pressed: show that source's details. */
  onInspect(turnId: string, sourceId: string): void;
  /** The source the open inspector shows, to mark its chip. */
  inspectedId?: string | null;
};

const NOTICE_TONE = {
  no_web: "bg-muted text-foreground",
  no_tools: "bg-muted text-foreground",
  tool_failed: "bg-warn text-warn-foreground",
  timeout: "bg-warn text-warn-foreground",
  limited: "bg-warn text-warn-foreground",
  trimmed: "bg-muted text-foreground",
  declined: "bg-muted text-foreground",
  withheld: "bg-warn text-warn-foreground",
} as const;

/** The question, right-aligned, as plain text. */
export function UserMessage({ turn }: { turn: Turn }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl bg-primary px-4 py-2 text-base leading-6 break-words whitespace-pre-wrap text-primary-foreground">
        {turn.text}
      </p>
    </div>
  );
}

const unique = (names: readonly string[]) => [...new Set(names)].join("、");

/** One shared empty list, so an answer without a verification keeps `AnswerView`'s props equal. */
const NONE: readonly string[] = [];

/** The wait before the first reply is called slow, and before it is called very slow. */
const SLOW_AFTER_MS = 8_000;
const SLOWER_AFTER_MS = 20_000;

/**
 * 0 until the answer has been waited for `SLOW_AFTER_MS`, 1 until `SLOWER_AFTER_MS`, then 2. Only
 * counts while nothing has arrived (`active`); time since the question went out, not an estimate
 * of what is left.
 */
function useSlowLevel(startedAt: number | null, active: boolean): 0 | 1 | 2 {
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    if (!active || startedAt === null) {
      setLevel(0);
      return;
    }
    const waited = Date.now() - startedAt;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (after: number, next: 1 | 2) => {
      if (waited >= after) setLevel(next);
      else timers.push(setTimeout(() => setLevel(next), after - waited));
    };
    at(SLOW_AFTER_MS, 1);
    at(SLOWER_AFTER_MS, 2);
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [active, startedAt]);
  return level;
}

const PHASE_ICON: Partial<Record<Phase, typeof CheckIcon>> = {
  complete: CheckIcon,
  stopped: SquareIcon,
  timeout: ClockIcon,
  withheld: TriangleAlertIcon,
  failed: TriangleAlertIcon,
  unknown: CircleHelpIcon,
};

/**
 * One AI answer: who and with what it was asked, its notices, what was looked up, the text, how it
 * ended, the sources and the number check, an offer to remember something, and (only once it
 * ended plainly) the fixed sentence. Generation status and evidence status are separate lines:
 * a complete answer can rest on no source, and a timed-out one can have sources.
 */
export function AssistantMessage({
  turn,
  lens,
  terms,
  onOpenTerm,
  onRemember,
  retry,
  onInspect,
  inspectedId = null,
}: Props) {
  // What happened to this answer's remember offer; kept here, so it lives as long as the answer.
  const [decision, setDecision] = useState<Decision | null>(null);
  const phase = phaseOf(turn);
  const finished = isComplete(turn);
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

  const waiting = phase === "waiting" || phase === "tools";
  const slow = useSlowLevel(turn.startedAt, waiting);

  const unsupported = turn.verification?.unsupported ?? NONE;
  const asked = turn.lens ?? lens;
  const sent = turn.context === null ? null : (contextLine(turn.context) ?? "none");

  return (
    <article data-phase={phase} className="flex flex-col gap-3">
      <header className="text-[0.8125rem] leading-5 text-muted-foreground">
        <span className="font-medium text-foreground">{ASK_COPY.chat.aiLabel}</span>
        {turn.lens !== null && <span>{` · ${ASK_COPY.chat.lens[asked]}`}</span>}
        {sent !== null && (
          <span>{` · ${sent === "none" ? ASK_COPY.chat.sentNothing : ASK_COPY.chat.sentWith(sent)}`}</span>
        )}
      </header>

      {turn.notices.map((notice, index) => (
        <p
          // A notice has no id and may repeat its kind; order is its identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          role="status"
          className={cn("rounded-lg px-3 py-2 text-sm leading-6", NOTICE_TONE[notice.kind])}
        >
          {notice.text}
        </p>
      ))}

      <Activity turn={turn} phase={phase} />

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
          // Two answer lines tall, so the first text replaces it without moving what is below.
          <div className="flex min-h-14 flex-col justify-center gap-2">
            <span className="sr-only">{ASK_COPY.chat.thinking}</span>
            <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
          </div>
        )
      )}

      {waiting && slow > 0 && (
        <p className="text-sm leading-6 text-muted-foreground">
          {slow === 1 ? ASK_COPY.chat.slow : ASK_COPY.chat.slower}
        </p>
      )}

      <EndStatus phase={phase} retry={retry} />

      <Evidence turn={turn} inspectedId={inspectedId} onInspect={onInspect} />

      {fact !== null && (
        <RememberOffer
          fact={fact}
          decision={decision}
          onAccept={(note) => setDecision(onRemember(note))}
          onDismiss={() => setDecision("dismissed")}
        />
      )}

      {finished && (
        <p className="text-[0.8125rem] leading-5 text-muted-foreground">{ASK_COPY.chat.verdict}</p>
      )}
    </article>
  );
}

/** What was looked up: one summary line, the calls and how each ended behind it. */
function Activity({ turn, phase }: { turn: Turn; phase: Phase }) {
  if (turn.tools.length === 0) return null;
  const counts = countTools(turn.tools);
  const COPY = ASK_COPY.chat.activity;
  const names = unique(counts.running.map((tool) => toolLabel(tool.name)));
  const done = [
    COPY.done(counts.succeeded + counts.failed + counts.denied),
    ...(counts.failed > 0 ? [COPY.failed(counts.failed)] : []),
    ...(counts.denied > 0 ? [COPY.denied(counts.denied)] : []),
  ].join(" · ");
  const summary = counts.running.length > 0 && phase !== "failed" ? COPY.running(names) : done;
  return (
    <details className="group">
      <summary
        aria-label={`${COPY.label}：${summary}`}
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-sm leading-6 text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <ul className="flex flex-col gap-1 pb-2 text-sm leading-6">
        {turn.tools.map((tool) => (
          <li key={tool.callId} className="flex justify-between gap-3">
            <span className="min-w-0 break-words">{toolLabel(tool.name)}</span>
            <span
              className={cn(
                "shrink-0",
                tool.state === "failed" || tool.state === "denied"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {COPY.state[tool.state]}
            </span>
          </li>
        ))}
        <li className="text-[0.8125rem] leading-5 text-muted-foreground">{COPY.returnedNote}</li>
      </ul>
    </details>
  );
}

/** How the answer ended, when it did not end plainly, and what asking again would use. */
function EndStatus({ phase, retry }: { phase: Phase; retry: RetryOffer | undefined }) {
  const label = ASK_COPY.chat.phase[phase];
  if (phase === "waiting" || phase === "tools" || phase === "generating") return null;
  const Icon = PHASE_ICON[phase];
  const retryable = (phase === "failed" || phase === "timeout") && retry !== undefined;
  const failed = phase === "failed";
  return (
    <div className="flex flex-col items-start gap-2">
      <p
        role={failed ? "alert" : undefined}
        className={cn(
          "flex items-center gap-2 text-sm leading-6",
          phase === "complete" && "text-muted-foreground",
          failed && "text-destructive",
          (phase === "stopped" || phase === "timeout" || phase === "withheld") && "text-foreground",
        )}
      >
        {Icon !== undefined && <Icon aria-hidden="true" className="size-4 shrink-0" />}
        <span>{label}</span>
      </p>
      {retryable &&
        (retry.hasOriginal ? (
          <>
            {retry.changed && (
              <p className="text-sm leading-6 text-muted-foreground">
                {ASK_COPY.chat.retryChanged}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
                onClick={() => retry.run("original")}
              >
                {ASK_COPY.chat.retryOriginal}
              </Button>
              {retry.changed && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
                  onClick={() => retry.run("current")}
                >
                  {ASK_COPY.chat.retryCurrent}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm leading-6 text-muted-foreground">{ASK_COPY.chat.retryRestored}</p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
              onClick={() => retry.run("current")}
            >
              {ASK_COPY.chat.retry}
            </Button>
          </>
        ))}
    </div>
  );
}

const EVIDENCE_TONE = {
  warn: "text-foreground",
  quiet: "text-muted-foreground",
} as const;

/**
 * The sources of an answer and the number check, apart from how the answer ended. The status
 * line says what the run found; the chips open each source's details; what the check found wrong
 * stays in view, and the notes about coverage sit behind a disclosure. Nothing here says
 * "verified": at best the numbers and links were compared with what the tools returned.
 */
function Evidence({
  turn,
  inspectedId,
  onInspect,
}: {
  turn: Turn;
  inspectedId: string | null;
  onInspect(turnId: string, sourceId: string): void;
}) {
  const COPY = ASK_COPY.chat.evidence;
  if (turn.streaming && turn.verification === null) return null;
  if (turn.text === "" && turn.verification === null) return null;
  const status = evidenceStatusOf(turn);
  const verification = turn.verification;
  const warnings = verification === null ? [] : verificationWarnings(verification);
  const notes = verification === null ? [] : evidenceNotes(verification);
  const records = verification?.evidence?.records ?? [];
  const omitted = verification?.evidence?.omitted ?? 0;

  let line: string | null;
  let tone: keyof typeof EVIDENCE_TONE = "quiet";
  switch (status) {
    case "pending":
      line = null;
      break;
    case "unavailable":
      line = COPY.unavailable;
      break;
    case "unchecked":
      line = null; // the warning list already says the check could not run
      break;
    case "unknown":
      line = COPY.unknown;
      break;
    case "none":
      line = COPY.none;
      tone = "warn";
      break;
    case "partial":
      line = COPY.partial;
      tone = "warn";
      break;
    case "sources":
      line = COPY.sources(verification?.evidence?.sources ?? 0);
      break;
  }

  if (line === null && warnings.length === 0 && records.length === 0 && notes.length === 0) {
    return null;
  }
  return (
    <section aria-label={COPY.heading} className="flex flex-col gap-2">
      {line !== null && <p className={cn("text-sm leading-6", EVIDENCE_TONE[tone])}>{line}</p>}
      {records.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {records.map((record, index) => (
            <li key={record.id}>
              <button
                type="button"
                data-source-chip={`${turn.id}:${record.id}`}
                aria-expanded={inspectedId === `${turn.id}:${record.id}`}
                aria-controls={INSPECTOR_ID}
                aria-haspopup="dialog"
                onClick={() => onInspect(turn.id, record.id)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm leading-6 outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  record.failed && "border-dashed text-muted-foreground",
                )}
              >
                {COPY.sourceChip(index + 1, toolLabel(record.tool))}
                {record.failed && <span>{`（${ASK_COPY.evidenceInspector.failed}）`}</span>}
              </button>
            </li>
          ))}
          {omitted > 0 && (
            <li className="flex min-h-11 items-center text-sm text-muted-foreground">
              {COPY.more(omitted)}
            </li>
          )}
        </ul>
      )}
      {warnings.map((note) => (
        <p key={note} className="text-sm leading-6 text-foreground">
          {note}
        </p>
      ))}
      {notes.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-sm leading-6 text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">{COPY.notes(notes.length)}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ul className="flex flex-col gap-1 pb-2">
            {notes.map((note) => (
              <li key={note} className="text-[0.8125rem] leading-5 text-muted-foreground">
                {note}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
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
  onAccept(note: string): void;
  onDismiss(): void;
}): ReactNode {
  if (decision === "saved") {
    return (
      <p role="status" className="text-sm leading-6 text-muted-foreground">
        {ASK_COPY.remember.saved}
      </p>
    );
  }
  if (decision === "full") {
    return (
      <p role="status" className="text-sm leading-6 text-muted-foreground">
        {ASK_COPY.remember.full}
      </p>
    );
  }
  if (decision === "failed") {
    return (
      <p role="status" className="text-sm leading-6 text-destructive">
        {ASK_COPY.remember.failed}
      </p>
    );
  }
  if (decision === "dismissed") return null;
  // Read at render, so a note saved or deleted elsewhere (the data sheet) is honoured.
  const notes = readMemoryNotes();
  if (notes.some((note) => note.text === normalizeNote(fact))) return null;
  // A note about the same thing is replaced, so a full list is no obstacle then. Asked of the
  // text as corrected, so the card never describes a different note than the one it would save.
  const replaceOf = (note: string) => replacementCandidate(notes, note)?.text;
  return (
    <RememberCard
      fact={fact}
      replaceOf={replaceOf}
      isFull={(note) => notes.length >= ASK_LIMITS.maxMemoryNotes && replaceOf(note) === undefined}
      onAccept={onAccept}
      onDismiss={onDismiss}
    />
  );
}
