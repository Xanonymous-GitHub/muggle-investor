"use client";

import { type KeyboardEvent, type RefObject, useRef } from "react";
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
};

/**
 * The question box. Enter sends (Shift+Enter breaks the line, an Enter that confirms an IME
 * composition does nothing), and a draft over the limit is blocked instead of cut: there is no
 * `maxlength`, because a paste into one would be clipped without a word.
 */
export function Composer({ value, onChange, onSend, onStop, streaming, offline, inputRef }: Props) {
  const text = value.trim();
  const over = text.length - ASK_LIMITS.maxMessageChars;
  const canSend = !offline && !streaming && text !== "" && over <= 0;
  const sentAtRef = useRef(0);
  const hintId = "ask-composer-hint";

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

  let hint: string | null = null;
  if (over <= 0 && over >= -HINT_WITHIN) hint = ASK_COPY.composer.remaining(-over);

  return (
    <div className="flex flex-col gap-1.5">
      {offline && (
        <p role="status" className="text-sm text-muted-foreground">
          {ASK_COPY.composer.offline}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          aria-label={ASK_COPY.composer.label}
          aria-describedby={hint !== null || over > 0 ? hintId : undefined}
          placeholder={ASK_COPY.composer.placeholder}
          rows={1}
          value={value}
          disabled={offline}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="field-sizing-content max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        />
        {streaming ? (
          <Button
            key="stop"
            type="button"
            variant="outline"
            className="min-h-11 min-w-16 px-4"
            onClick={stop}
          >
            {ASK_COPY.composer.stop}
          </Button>
        ) : (
          <Button
            key="send"
            type="button"
            className="min-h-11 min-w-16 px-4"
            disabled={!canSend}
            onClick={send}
          >
            {ASK_COPY.composer.send}
          </Button>
        )}
      </div>
      {over > 0 ? (
        <p id={hintId} role="alert" className="text-sm text-destructive">
          {ASK_COPY.composer.over(over)}
        </p>
      ) : (
        hint !== null && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
