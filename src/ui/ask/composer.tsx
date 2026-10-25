"use client";

import { type KeyboardEvent, type ReactNode, type RefObject, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ASK_COPY } from "@/ui/ask/copy";
import { ASK_LIMITS } from "@/ui/ask/limits";

/** The remaining-characters hint appears this close to the limit. */
const HINT_WITHIN = 200;
/**
 * Send turns into stop at the same spot, so the second click of a double click would land on
 * stop and cancel the answer it just asked for. A stop this soon after sending is such a click.
 */
const DOUBLE_CLICK_MS = 400;

type Props = {
  /** The draft; the screen owns it so a pending first-use disclosure can leave it untouched. */
  value: string;
  onChange(value: string): void;
  /** Called with the trimmed text; the screen clears the draft when it really sends. */
  onSend(text: string): void;
  onStop(): void;
  streaming: boolean;
  offline: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Shown in the status row when nothing else needs saying (what the next question carries). */
  summary?: ReactNode;
  /** The box holds an earlier question being reworded: sending replaces it and its answer. */
  editing?: boolean;
  onCancelEdit?(): void;
  /** The device refused the draft: it will not survive leaving the page. */
  draftFailed?: boolean;
};

/**
 * The question box. Enter sends (Shift+Enter breaks the line, an Enter that confirms an IME
 * composition does nothing), and a draft over the limit is blocked instead of cut: there is no
 * `maxlength`, because a paste into one would be clipped without a word. Writing is always
 * possible, offline or while an answer streams; only sending waits, and the status row under the
 * box says why. That row is always there, so its text coming and going moves nothing.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  offline,
  inputRef,
  summary,
  editing = false,
  onCancelEdit,
  draftFailed = false,
}: Props) {
  const text = value.trim();
  const over = text.length - ASK_LIMITS.maxMessageChars;
  const canSend = !offline && !streaming && text !== "" && over <= 0;
  const sentAtRef = useRef(0);
  const statusId = "ask-composer-status";
  const overId = "ask-composer-over";

  const send = () => {
    if (!canSend) return;
    sentAtRef.current = Date.now();
    onSend(text);
    inputRef.current?.focus();
  };
  const stop = () => {
    if (Date.now() - sentAtRef.current < DOUBLE_CLICK_MS) return;
    onStop();
    inputRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    // `isComposing` is false on the Enter that ends a composition in Safari, which reports 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  // One line of status, most pressing first.
  let status: ReactNode = summary ?? ASK_COPY.composer.draftKept;
  if (draftFailed) status = ASK_COPY.composer.draftFailed;
  else if (over >= -HINT_WITHIN && over <= 0) status = ASK_COPY.composer.remaining(-over);
  if (streaming && over <= 0) status = ASK_COPY.composer.busyReason;
  if (offline && over <= 0) status = ASK_COPY.composer.offlineReason;

  return (
    <div data-slot="composer" className="flex flex-col gap-1">
      {editing && (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{ASK_COPY.composer.editing}</span>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 shrink-0 px-3 active:not-aria-[haspopup]:translate-y-0"
            onClick={onCancelEdit}
          >
            {ASK_COPY.composer.cancelEdit}
          </Button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          aria-label={ASK_COPY.composer.label}
          aria-describedby={over > 0 ? `${overId} ${statusId}` : statusId}
          placeholder={ASK_COPY.composer.placeholder}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="field-sizing-content max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-control bg-background px-3 py-2.25 text-base leading-6 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {/* One slot for both, so swapping Send for Stop changes nothing around it. */}
        <div className="flex h-11 w-16 shrink-0">
          {streaming ? (
            <Button
              key="stop"
              type="button"
              variant="outline"
              className="h-full w-full px-0 active:not-aria-[haspopup]:translate-y-0"
              onClick={stop}
            >
              {ASK_COPY.composer.stop}
            </Button>
          ) : (
            <Button
              key="send"
              type="button"
              className="h-full w-full px-0 active:not-aria-[haspopup]:translate-y-0"
              disabled={!canSend}
              onClick={send}
            >
              {ASK_COPY.composer.send}
            </Button>
          )}
        </div>
      </div>
      {over > 0 && (
        <p id={overId} role="alert" className="text-sm text-destructive">
          {ASK_COPY.composer.over(ASK_LIMITS.maxMessageChars)}
        </p>
      )}
      <p
        id={statusId}
        role={offline ? "status" : undefined}
        className="min-h-5 text-[0.8125rem] leading-5 text-muted-foreground"
      >
        {over > 0 ? ASK_COPY.composer.overBy(over) : status}
      </p>
    </div>
  );
}
