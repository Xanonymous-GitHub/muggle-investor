"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AssistantMessage, UserMessage } from "@/ui/ask/assistant-message";
import { Composer } from "@/ui/ask/composer";
import { ASK_COPY } from "@/ui/ask/copy";
import { DisclosureDialog } from "@/ui/ask/disclosure-dialog";
import { MessageList } from "@/ui/ask/message-list";
import { MyDataSheet } from "@/ui/ask/my-data-sheet";
import {
  addMemoryNote,
  normalizeNote,
  readAck,
  readMemory,
  writeAck,
  writeMemory,
} from "@/ui/ask/stores";
import { SuggestedQuestions } from "@/ui/ask/suggested-questions";
import { type AskError, useAskChat } from "@/ui/ask/use-ask-chat";
import { useSettings } from "@/ui/device/settings-provider";
import { useTermPanel } from "@/ui/glossary/term-panel";
import { useGlossary } from "@/ui/glossary/use-glossary";
import { useOnline } from "@/ui/shell/use-online";

type Props = {
  /** The server no longer knows this browser: the gate shows the invite screen again. */
  onSignedOut(): void;
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

/**
 * The Ask screen once signed in: header, conversation, the question box. The first question waits
 * for the one-time disclosure; the rest is the chat hook's.
 */
export function AskChat({ onSignedOut, fetchImpl }: Props) {
  const chat = useAskChat({ fetchImpl });
  const { settings } = useSettings();
  const online = useOnline();
  const glossary = useGlossary();
  const { open: openTerm, panel: termPanel } = useTermPanel(glossary.byId);

  const [draft, setDraft] = useState("");
  // A question waiting for the first-use disclosure to be agreed to.
  const [pending, setPending] = useState<string | null>(null);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const dataButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const newChatRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const signedOutRef = useRef(onSignedOut);
  signedOutRef.current = onSignedOut;
  useEffect(() => {
    if (chat.signedOut) signedOutRef.current();
  }, [chat.signedOut]);

  useEffect(() => {
    if (confirmingNew) cancelRef.current?.focus();
  }, [confirmingNew]);

  const streaming = chat.status === "streaming";
  const empty = chat.turns.length === 0;

  /** Sends `text`; the draft is cleared only when it was what got sent. */
  const dispatch = useCallback(
    (text: string) => {
      chat.send(text);
      setDraft((current) => (current.trim() === text ? "" : current));
    },
    [chat],
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

  const retry = () => {
    const lastQuestion = chat.turns.findLast((turn) => turn.role === "user");
    if (lastQuestion !== undefined) chat.send(lastQuestion.text);
  };

  const startNew = () => {
    if (empty) chat.newChat();
    else setConfirmingNew(true);
  };

  /** The only writer of memory: runs when the person presses 記住. True when the note is stored. */
  const remember = (note: string): boolean => {
    const notes = readMemory();
    const next = addMemoryNote(notes, note);
    if (next === notes) return notes.includes(normalizeNote(note));
    return writeMemory(next);
  };

  const errorLine = chat.error === null ? null : errorText(chat.error);
  const lastIndex = chat.turns.length - 1;

  return (
    <div data-testid="ask-chat" className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{ASK_COPY.title}</h1>
        <div className="flex gap-2">
          <Button
            ref={dataButtonRef}
            type="button"
            variant="outline"
            className="min-h-11 px-3"
            onClick={() => setDataOpen(true)}
          >
            {ASK_COPY.chat.myData}
          </Button>
          <Button
            ref={newChatRef}
            type="button"
            variant="outline"
            className="min-h-11 px-3"
            onClick={startNew}
          >
            {ASK_COPY.chat.newChat}
          </Button>
        </div>
      </header>

      {confirmingNew && (
        <section
          aria-label={ASK_COPY.chat.newChat}
          className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm"
        >
          <p>{ASK_COPY.chat.newChatConfirm}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              className="min-h-11 px-4"
              onClick={() => {
                setConfirmingNew(false);
                chat.newChat();
                inputRef.current?.focus();
              }}
            >
              {ASK_COPY.chat.newChatYes}
            </Button>
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              className="min-h-11 px-4"
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
        renderTurn={(turn, index) =>
          turn.role === "user" ? (
            <UserMessage turn={turn} />
          ) : (
            <AssistantMessage
              turn={turn}
              lens={settings.lens}
              terms={glossary.terms}
              onOpenTerm={openTerm}
              onRemember={remember}
              onRetry={index === lastIndex && online && !streaming ? retry : undefined}
            />
          )
        }
      />

      {errorLine !== null && chat.error !== null && (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p role="alert" className="text-destructive">
            {errorLine}
          </p>
          {RETRYABLE.includes(chat.error.kind) && online && (
            <Button type="button" variant="outline" className="min-h-11 px-4" onClick={retry}>
              {ASK_COPY.errors.retry}
            </Button>
          )}
        </div>
      )}

      {/* Above the fixed bottom bar on a phone (h-16 plus the home-indicator inset); at the
          bottom of the content from md up, where the bar is a sidebar. */}
      <div
        data-slot="ask-composer"
        className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[5] -mx-4 border-t bg-background px-4 py-2 md:bottom-0 md:mx-0 md:px-0"
      >
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={submit}
          onStop={chat.stop}
          streaming={streaming}
          offline={!online}
          inputRef={inputRef}
        />
      </div>

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
        onOpenChange={setDataOpen}
        triggerRef={dataButtonRef}
        onCleared={() => {
          // The sheet already asked; this only empties what is on screen (and stops a running answer).
          chat.newChat();
          setConfirmingNew(false);
          setPending(null);
          setDraft("");
        }}
      />
      {termPanel}
    </div>
  );
}
