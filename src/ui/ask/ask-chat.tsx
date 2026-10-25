"use client";

import { ArrowDownIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AssistantMessage,
  type RememberResult,
  type RetryOffer,
  UserMessage,
} from "@/ui/ask/assistant-message";
import { Composer } from "@/ui/ask/composer";
import { contextLine } from "@/ui/ask/context-text";
import { ASK_COPY } from "@/ui/ask/copy";
import { DisclosureDialog } from "@/ui/ask/disclosure-dialog";
import {
  EvidenceInspector,
  INSPECTOR_BESIDE_QUERY,
  type InspectorTarget,
} from "@/ui/ask/evidence-inspector";
import { MessageList, scrollToLatest } from "@/ui/ask/message-list";
import { MyDataSheet } from "@/ui/ask/my-data-sheet";
import { isComplete, phaseOf } from "@/ui/ask/phase";
import { type ContextSummary, currentPlanRequest, describeOutgoing } from "@/ui/ask/request";
import {
  readAck,
  readDraft,
  readHoldings,
  readMemory,
  readPlanOptIn,
  rememberFact,
  writeAck,
  writeDraft,
} from "@/ui/ask/stores";
import { SuggestedQuestions } from "@/ui/ask/suggested-questions";
import { type AskError, useAskChat } from "@/ui/ask/use-ask-chat";
import { useSettings } from "@/ui/device/settings-provider";
import { useTermPanel } from "@/ui/glossary/term-panel";
import { useGlossary } from "@/ui/glossary/use-glossary";
import { useMediaQuery } from "@/ui/glossary/use-media-query";
import { useOnline } from "@/ui/shell/use-online";

type Props = {
  /**
   * The server no longer knows this browser: the gate shows the invite screen again. Gets the
   * draft, or else the question that got no answer, so it can come back after signing in.
   */
  onSignedOut(question?: string): void;
  /** What the question box starts with (in memory only: the question a sign-out left behind). */
  initialDraft?: string;
  /** Tests pass a fake; the app uses `fetch`. */
  fetchImpl?: typeof fetch;
};

/** The words for a question that got no answer at all. `signed_out` has none: the gate takes over. */
function errorText(error: AskError): string | null {
  switch (error.kind) {
    case "rate_limited":
      return error.used !== null && error.limit !== null
        ? ASK_COPY.errors.rateLimited(error.used, error.limit)
        : ASK_COPY.errors.rateLimitedPlain;
    case "unavailable":
      return ASK_COPY.errors.unavailable;
    case "too_large":
      return ASK_COPY.errors.tooLarge;
    case "offline":
      return ASK_COPY.errors.offline;
    case "failed":
      return ASK_COPY.errors.failed;
    case "signed_out":
      return null;
  }
}

/**
 * Asking again can help for these. A spent daily allowance does not come back by retrying, and a
 * conversation too large for the server would be sent again unchanged.
 */
const RETRYABLE: readonly AskError["kind"][] = ["unavailable", "offline", "failed"];

/** A draft is written to the device this long after the last keystroke. */
const DRAFT_SAVE_MS = 400;

const sameContext = (a: ContextSummary, b: ContextSummary): boolean =>
  a.plan === b.plan && a.holdings === b.holdings && a.memory === b.memory;

/** What the next question would carry, read from the device the way `buildAskBody` reads it. */
const readContext = (): ContextSummary =>
  describeOutgoing({
    holdings: readHoldings(),
    memory: readMemory(),
    plan: currentPlanRequest(readPlanOptIn()),
  });

const chipKey = (turnId: string, sourceId: string) => `${turnId}:${sourceId}`;

const chipOf = (key: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-source-chip="${CSS.escape(key)}"]`);

/** Where a source chip is on the screen, or null when it is not on the page. */
const chipTop = (key: string): number | null => chipOf(key)?.getBoundingClientRect().top ?? null;

/**
 * The Ask screen once signed in: header, conversation, the question box, and the evidence of an
 * answer beside it or in a sheet. The first question waits for the one-time disclosure; the rest
 * is the chat hook's.
 */
export function AskChat({ onSignedOut, initialDraft, fetchImpl }: Props) {
  const chat = useAskChat({ fetchImpl });
  const { settings, setLens } = useSettings();
  const online = useOnline();
  const glossary = useGlossary();
  const { open: openTerm, panel: termPanel } = useTermPanel(glossary.byId);
  const beside = useMediaQuery(INSPECTOR_BESIDE_QUERY);

  const [draft, setDraft] = useState(initialDraft ?? "");
  const [draftReady, setDraftReady] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  // A question waiting for the first-use disclosure to be agreed to.
  const [pending, setPending] = useState<string | null>(null);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  // The earlier question being reworded; `before` is what the box held, to put back on cancel.
  const [editing, setEditing] = useState<{ before: string } | null>(null);
  const [away, setAway] = useState(false);
  const [inspect, setInspect] = useState<{ turnId: string; sourceId: string } | null>(null);
  const [lensNote, setLensNote] = useState(false);
  const [context, setContext] = useState<ContextSummary | null>(null);
  const dataButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const newChatRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Where the source chip sat on screen when the inspector opened or closed, and the chip to
  // return focus to; both are used once, after the layout has changed.
  const anchorRef = useRef<{ key: string; top: number } | null>(null);
  const focusChipRef = useRef<string | null>(null);

  // A question still waiting for its answer: the last turn is the person's.
  const tail = chat.turns.at(-1);
  const unanswered = tail?.role === "user" ? tail.text : null;

  const signedOutRef = useRef(onSignedOut);
  signedOutRef.current = onSignedOut;
  const leftoverRef = useRef<string | undefined>(undefined);
  leftoverRef.current = draft.trim() !== "" ? draft : (unanswered ?? undefined);
  useEffect(() => {
    if (chat.signedOut) signedOutRef.current(leftoverRef.current);
  }, [chat.signedOut]);

  useEffect(() => {
    if (confirmingNew) cancelRef.current?.focus();
  }, [confirmingNew]);

  // The draft the device kept (after hydration, so server and client markup agree). A question a
  // sign-out left behind wins over it.
  useEffect(() => {
    if (initialDraft === undefined || initialDraft === "") {
      const kept = readDraft();
      if (kept !== "") setDraft(kept);
    }
    setDraftReady(true);
  }, [initialDraft]);

  // Kept shortly after typing stops, at once when the page is hidden or the screen closes.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveDraft = useCallback(() => {
    const ok = writeDraft(draftRef.current);
    setDraftFailed(!ok && draftRef.current.trim() !== "");
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `draft` is the trigger, `saveDraft` reads the ref
  useEffect(() => {
    if (!draftReady) return;
    const timer = setTimeout(saveDraft, DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, draftReady, saveDraft]);
  useEffect(() => {
    if (!draftReady) return;
    const flush = () => void writeDraft(draftRef.current);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [draftReady]);

  // What the next question would carry; read again whenever it may have changed.
  const refreshContext = useCallback(() => setContext(readContext()), []);
  useEffect(() => {
    refreshContext();
    window.addEventListener("storage", refreshContext);
    return () => window.removeEventListener("storage", refreshContext);
  }, [refreshContext]);

  const streaming = chat.status === "streaming";
  const empty = chat.turns.length === 0;

  /** Sends `text`; the draft is cleared only when it was what got sent. */
  const dispatch = useCallback(
    (text: string) => {
      chat.send(text, editing !== null ? { replaceLast: true } : undefined);
      setEditing(null);
      setLensNote(false);
      setDraft((current) => (current.trim() === text ? "" : current));
    },
    [chat, editing],
  );

  const submit = (raw: string) => {
    const text = raw.trim();
    if (text === "" || !online || streaming) return;
    if (!readAck()) {
      setPending(text);
      return;
    }
    dispatch(text);
  };

  const agree = () => {
    const text = pending;
    writeAck();
    setPending(null);
    if (text !== null) dispatch(text);
  };

  const startNew = () => {
    if (empty) chat.newChat();
    else setConfirmingNew(true);
  };

  /**
   * The only writer of memory: runs when the person presses 記住. The list may have filled up
   * since the card was shown (another card, the data sheet), which is not a storage failure.
   */
  const remember = useCallback((note: string): RememberResult => {
    const result = rememberFact(note);
    if (result === "saved") setContext(readContext());
    return result;
  }, []);

  const edit = (text: string) => {
    setEditing({ before: draft });
    setDraft(text);
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    setDraft(editing?.before ?? "");
    setEditing(null);
    inputRef.current?.focus();
  };

  // Follow-up questions only fill the box: nothing is sent until the person sends it.
  const prefill = (text: string) => {
    setDraft(text);
    inputRef.current?.focus();
  };

  // ── The evidence inspector ────────────────────────────────────────────────────────────────
  const target = useMemo((): InspectorTarget | null => {
    if (inspect === null) return null;
    const turn = chat.turns.find((t) => t.id === inspect.turnId);
    const records = turn?.verification?.evidence?.records ?? [];
    const index = records.findIndex((r) => r.id === inspect.sourceId);
    const record = records[index];
    return record === undefined ? null : { turnId: inspect.turnId, index: index + 1, record };
  }, [inspect, chat.turns]);

  const onInspect = useCallback(
    (turnId: string, sourceId: string) => {
      const key = chipKey(turnId, sourceId);
      const top = chipTop(key);
      anchorRef.current = top === null ? null : { key, top };
      // Pressing the chip of the source that is open closes it, and focus stays on that chip.
      const same = inspect?.turnId === turnId && inspect.sourceId === sourceId;
      if (same) focusChipRef.current = key;
      setInspect(same ? null : { turnId, sourceId });
    },
    [inspect],
  );

  const closeInspector = useCallback(() => {
    if (inspect !== null) {
      const key = chipKey(inspect.turnId, inspect.sourceId);
      const top = chipTop(key);
      anchorRef.current = top === null ? null : { key, top };
      focusChipRef.current = key;
    }
    setInspect(null);
  }, [inspect]);

  // The panel changes the width of the column, which rewraps the answer. Keep the chip that
  // opened it where it was on the screen, so the claim being read does not move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `inspect` and `beside` are the triggers
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (anchor === null) return;
    const top = chipTop(anchor.key);
    if (top !== null && Math.abs(top - anchor.top) >= 1) window.scrollBy(0, top - anchor.top);
  }, [inspect, beside]);

  useEffect(() => {
    const key = focusChipRef.current;
    if (key === null || inspect !== null) return;
    focusChipRef.current = null;
    chipOf(key)?.focus({ preventScroll: true });
  }, [inspect]);

  // ── Derived for rendering ─────────────────────────────────────────────────────────────────
  // Offline, the composer already says a connection is needed; the same words twice add nothing.
  const errorLine =
    chat.error === null || (chat.error.kind === "offline" && !online)
      ? null
      : errorText(chat.error);
  const lastIndex = chat.turns.length - 1;
  const lastTurn = chat.turns.at(-1);
  const lastAnswer = chat.turns.findLast((turn) => turn.role === "assistant");
  const lastQuestionIndex = chat.turns.findLastIndex((turn) => turn.role === "user");
  const canFollowUp =
    !streaming && lastAnswer !== undefined && lastTurn === lastAnswer && isComplete(lastAnswer);

  /** Whether asking the last question again can send what it first went out with. */
  const retryOffer = (index: number): RetryOffer | undefined => {
    if (index !== lastIndex || !online || streaming) return undefined;
    const question = chat.turns[index - 1];
    const ask = chat.lastAsk;
    const hasOriginal = ask !== null && question?.text === ask.text;
    const changed =
      hasOriginal &&
      (ask.lens !== settings.lens || (context !== null && !sameContext(ask.context, context)));
    return { hasOriginal, changed, run: chat.retry };
  };

  const nextQuestion =
    context === null
      ? null
      : `${ASK_COPY.context.label}：${ASK_COPY.chat.lens[settings.lens]} · ${
          contextLine(context) ?? ASK_COPY.context.none
        }`;
  // A broken answer is already an alert in the answer itself; saying it twice would read twice.
  const lastPhase = lastAnswer === undefined ? null : phaseOf(lastAnswer);
  const phaseNote =
    lastPhase === null || lastPhase === "failed" ? "" : ASK_COPY.chat.phase[lastPhase];

  const changeLens = (lens: "beginner" | "pro") => {
    if (lens === settings.lens) return;
    setLens(lens);
    setLensNote(true);
  };

  return (
    <div data-testid="ask-chat" data-keyline="region" className="flex w-full items-start gap-6">
      {/* As tall as the room under the shell's header (3.75rem, phones) or top padding (1.5rem,
          md+) and above the bottom bar, so the composer sits at the bottom of the screen before
          there is anything to scroll, and does not jump when the first answer arrives. */}
      <div
        data-keyline="column"
        className={cn(
          "mx-auto flex w-full max-w-[42rem] min-w-0 flex-1 flex-col gap-6",
          "min-h-[calc(100svh-3.75rem-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:min-h-[calc(100svh-1.5rem)]",
          "[@media(max-height:30rem)]:min-h-0",
        )}
      >
        <div className="flex flex-col gap-3">
          <header
            data-keyline="header"
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
          >
            <h1 className="text-xl leading-7 font-bold">{ASK_COPY.title}</h1>
            <div className="flex gap-2">
              <Button
                ref={dataButtonRef}
                type="button"
                variant="outline"
                className="min-h-11 px-3 active:not-aria-[haspopup]:translate-y-0"
                onClick={() => setDataOpen(true)}
              >
                {ASK_COPY.chat.myData}
              </Button>
              <Button
                ref={newChatRef}
                type="button"
                variant="outline"
                className="min-h-11 px-3 active:not-aria-[haspopup]:translate-y-0"
                onClick={startNew}
              >
                {ASK_COPY.chat.newChat}
              </Button>
            </div>
          </header>
          <fieldset
            data-keyline="context"
            className="m-0 flex min-w-0 items-center gap-3 border-0 p-0 text-sm leading-6"
          >
            <legend className="sr-only">{ASK_COPY.context.lensLabel}</legend>
            <span aria-hidden="true" className="text-muted-foreground">
              {ASK_COPY.context.lensLabel}
            </span>
            {/* Container radius = button radius + the 1 px border between them. */}
            <div className="flex rounded-lg border">
              {(["beginner", "pro"] as const).map((lens) => (
                <Button
                  key={lens}
                  type="button"
                  variant={settings.lens === lens ? "default" : "ghost"}
                  aria-pressed={settings.lens === lens}
                  className="min-h-11 min-w-16 rounded-[calc(var(--radius-lg)-1px)] px-3 active:not-aria-[haspopup]:translate-y-0"
                  onClick={() => changeLens(lens)}
                >
                  {ASK_COPY.context.lens[lens]}
                </Button>
              ))}
            </div>
          </fieldset>
        </div>

        {confirmingNew && (
          <section
            aria-label={ASK_COPY.chat.newChat}
            className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm leading-6"
          >
            <p>{ASK_COPY.chat.newChatConfirm}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
                onClick={() => {
                  setConfirmingNew(false);
                  chat.newChat();
                  setEditing(null);
                  setInspect(null);
                  inputRef.current?.focus();
                }}
              >
                {ASK_COPY.chat.newChatYes}
              </Button>
              <Button
                ref={cancelRef}
                type="button"
                variant="outline"
                className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
                onClick={() => {
                  setConfirmingNew(false);
                  newChatRef.current?.focus();
                }}
              >
                {ASK_COPY.chat.newChatNo}
              </Button>
            </div>
          </section>
        )}

        {empty && <SuggestedQuestions disabled={!online} onPick={submit} />}

        <MessageList
          turns={chat.turns}
          busy={streaming}
          onAway={setAway}
          renderTurn={(turn, index) =>
            turn.role === "user" ? (
              <div className="flex flex-col items-end">
                <UserMessage turn={turn} />
                {index === lastQuestionIndex && !streaming && editing === null && (
                  <Button
                    type="button"
                    variant="ghost"
                    // px-4 puts the label on the same right edge as the text inside the bubble above.
                    className="min-h-11 px-4 text-muted-foreground active:not-aria-[haspopup]:translate-y-0"
                    onClick={() => edit(turn.text)}
                  >
                    {ASK_COPY.chat.editQuestion}
                  </Button>
                )}
              </div>
            ) : (
              <AssistantMessage
                turn={turn}
                lens={settings.lens}
                terms={glossary.terms}
                onOpenTerm={openTerm}
                onRemember={remember}
                retry={retryOffer(index)}
                onInspect={onInspect}
                inspectedId={inspect === null ? null : chipKey(inspect.turnId, inspect.sourceId)}
              />
            )
          }
        />

        <p role="status" className="sr-only">
          {phaseNote}
        </p>

        {canFollowUp && (
          <section aria-label={ASK_COPY.chat.followUps.label} className="flex flex-col gap-2">
            <p className="text-sm leading-6 text-muted-foreground">
              {ASK_COPY.chat.followUps.label}
              <span className="text-[0.8125rem]">{`（${ASK_COPY.chat.followUps.hint}）`}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {ASK_COPY.chat.followUps.items.map((question) => (
                <Button
                  key={question}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 px-3 py-2 text-left whitespace-normal active:not-aria-[haspopup]:translate-y-0"
                  onClick={() => prefill(question)}
                >
                  {question}
                </Button>
              ))}
            </div>
          </section>
        )}

        {/* After a reload, or a stop before any text, the question sits alone: offer to ask it. */}
        {unanswered !== null && !streaming && chat.error === null && online && (
          <div className="flex flex-col items-start text-sm">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
              onClick={() => chat.retry()}
            >
              {ASK_COPY.chat.retry}
            </Button>
          </div>
        )}

        {errorLine !== null && chat.error !== null && (
          <div className="flex flex-col items-start gap-2 text-sm leading-6">
            <p role="alert" className="text-destructive">
              {errorLine}
            </p>
            {RETRYABLE.includes(chat.error.kind) && online && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 px-4 active:not-aria-[haspopup]:translate-y-0"
                onClick={() => chat.retry()}
              >
                {ASK_COPY.errors.retry}
              </Button>
            )}
          </div>
        )}

        {/* Above the fixed bottom bar on a phone (h-16 plus the home-indicator inset); at the
            bottom of the content from md up, where the bar is a sidebar. The band behind it is a
            pseudo-element reaching into the page gutters, so it covers the text scrolling under
            it without moving the box off the column's edges. In a short landscape window the box
            is not sticky: it would take half the screen. */}
        <div
          data-slot="ask-composer"
          data-keyline="composer"
          className={cn(
            "sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[5] mt-auto py-2 md:bottom-0",
            "before:absolute before:inset-y-0 before:-inset-x-4 before:-z-10 before:border-t before:border-border before:bg-background md:before:inset-x-0",
            // Static, the box is no longer the anchor of its band: the band would cover the page.
            "[@media(max-height:30rem)]:static [@media(max-height:30rem)]:before:hidden",
          )}
        >
          {away && !empty && (
            <Button
              type="button"
              variant="outline"
              className="absolute right-0 bottom-full mb-2 min-h-11 gap-1.5 px-3 shadow-sm active:not-aria-[haspopup]:translate-y-0"
              onClick={() => {
                scrollToLatest();
                inputRef.current?.focus({ preventScroll: true });
              }}
            >
              <ArrowDownIcon aria-hidden="true" />
              {ASK_COPY.chat.jumpToLatest}
            </Button>
          )}
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={submit}
            onStop={chat.stop}
            streaming={streaming}
            offline={!online}
            inputRef={inputRef}
            summary={lensNote ? ASK_COPY.context.lensNote : nextQuestion}
            editing={editing !== null}
            onCancelEdit={cancelEdit}
            draftFailed={draftFailed}
          />
        </div>
      </div>

      <EvidenceInspector target={target} beside={beside} onClose={closeInspector} />

      <DisclosureDialog
        open={pending !== null}
        onAgree={agree}
        onClose={() => setPending(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      />
      <MyDataSheet
        open={dataOpen}
        onOpenChange={(open) => {
          setDataOpen(open);
          if (!open) refreshContext();
        }}
        triggerRef={dataButtonRef}
        onCleared={() => {
          // The sheet already asked; this only empties what is on screen (and stops a running answer).
          chat.newChat();
          setConfirmingNew(false);
          setPending(null);
          setDraft("");
          setEditing(null);
          setInspect(null);
          refreshContext();
        }}
      />
      {termPanel}
    </div>
  );
}
