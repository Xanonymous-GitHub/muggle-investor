"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { ASK_COPY } from "@/ui/ask/copy";
import type { Turn } from "@/ui/ask/use-ask-chat";

/** Closer than this to the end of the page counts as "at the bottom" (the composer and padding sit below). */
const AT_BOTTOM_PX = 160;

const distanceFromBottom = () =>
  document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);

/** What changes how tall the list is: a new turn, more text, a tool starting, a footnote arriving. */
function heightKey(turns: readonly Turn[]): string {
  const last = turns.at(-1);
  if (last === undefined) return "0";
  const tools = last.tools.map((tool) => (tool.done ? 1 : 0)).join("");
  return [
    turns.length,
    last.text.length,
    tools,
    last.notices.length,
    last.verification === null ? "-" : "v",
    last.streaming ? "s" : "",
    last.failed ? "f" : "",
    last.stopped ? "x" : "",
  ].join(":");
}

/**
 * The conversation. The page scrolls (the app shell has no inner scroller), so following the
 * answer means scrolling the window, and only while the reader is at the bottom: scrolling up to
 * re-read stops it until they come back, and a new question always brings them down. The scroll
 * is instant, never animated, so reduced motion needs no special case. While an answer streams
 * the log is `aria-busy`, so a screen reader announces it when it is complete, not word by word.
 */
export function MessageList({
  turns,
  busy,
  renderTurn,
}: {
  turns: readonly Turn[];
  busy: boolean;
  renderTurn(turn: Turn, index: number): ReactNode;
}) {
  const following = useRef(true);
  const count = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      following.current = distanceFromBottom() <= AT_BOTTOM_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const key = heightKey(turns);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trigger, not a value the effect reads
  useLayoutEffect(() => {
    if (turns.length > count.current) following.current = true;
    count.current = turns.length;
    if (turns.length > 0 && following.current) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
    }
  }, [key]);

  return (
    <div
      role="log"
      aria-label={ASK_COPY.chat.logLabel}
      aria-live="polite"
      aria-busy={busy}
      aria-relevant="additions"
      className="flex flex-col gap-5"
    >
      {turns.map((turn, index) => (
        <div key={turn.id}>{renderTurn(turn, index)}</div>
      ))}
    </div>
  );
}
