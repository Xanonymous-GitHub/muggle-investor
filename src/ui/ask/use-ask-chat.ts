"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AskNotice, AskVerification } from "@/ask/ask-message";
import { ASK_LIMITS } from "@/ui/ask/limits";
import { type AskBody, buildAskBody, currentPlanRequest } from "@/ui/ask/request";
import {
  type ChatMessage,
  clearChat,
  readChat,
  readHoldings,
  readMemory,
  readPlanOptIn,
  writeChat,
} from "@/ui/ask/stores";
import { useSettings } from "@/ui/device/settings-provider";

export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  notices: AskNotice[];
  verification: AskVerification | null;
  /** Tool calls of this answer, in the order they started. */
  tools: { name: string; done: boolean }[];
  streaming: boolean;
  /** The answer broke off (an error in the stream, or the connection dropped); its text is kept. */
  failed: boolean;
  /** The person stopped this answer; its text is partial but was not an error. */
  stopped: boolean;
  /** Loaded from the device, not received in this page session. In memory only, never stored. */
  restored?: true;
};

export type AskError =
  | { kind: "rate_limited"; used: number | null; limit: number | null }
  | { kind: "unavailable" }
  | { kind: "too_large" }
  | { kind: "signed_out" }
  | { kind: "offline" }
  | { kind: "failed" };

export type AskChat = {
  turns: Turn[];
  status: "idle" | "streaming";
  /** Why the last question got no answer at all; null otherwise (a broken answer is `failed` on its turn). */
  error: AskError | null;
  send(text: string): void;
  stop(): void;
  newChat(): void;
  signedOut: boolean;
};

const ASK_URL = "/api/ask";
const NOTICE_KINDS: readonly string[] = ["no_web", "no_tools", "tool_failed", "timeout"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The JSON of each `data:` event of a Server-Sent Events body, in order. Handles events cut at
 * any byte, CRLF / LF / CR line ends, comments and the `[DONE]` marker; an event that is not
 * JSON is skipped. Stops reading (cancelling the body) when the consumer stops iterating.
 */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];

  const dispatch = (): unknown[] => {
    const payload = data.join("\n");
    data = [];
    if (payload === "" || payload === "[DONE]") return [];
    try {
      return [JSON.parse(payload) as unknown];
    } catch {
      return [];
    }
  };
  const line = (text: string): unknown[] => {
    if (text === "") return dispatch();
    if (text.startsWith("data:")) data.push(text.slice(text.startsWith("data: ") ? 6 : 5));
    return [];
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A trailing CR may be the first half of a CRLF split across reads: wait for the next one.
      const cut = !done && buffer.endsWith("\r") ? buffer.length - 1 : buffer.length;
      const lines = buffer.slice(0, cut).split(/\r\n|\n|\r/);
      buffer = (done ? "" : (lines.pop() ?? "")) + buffer.slice(cut);
      for (const text of lines) yield* line(text);
      if (done) {
        yield* dispatch();
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

type RunState = {
  /** Tool call id -> index in the turn's `tools`. */
  tools: Map<string, number>;
  sawFinish: boolean;
};

/** What goes between the text so far and a new text part: enough to make a blank line. */
function partSeparator(text: string): string {
  if (text === "" || text.endsWith("\n\n")) return "";
  return text.endsWith("\n") ? "\n" : "\n\n";
}

/** The turn after one stream chunk; chunks this screen does not show leave it as it was. */
function applyChunk(turn: Turn, chunk: unknown, run: RunState): Turn {
  if (!isRecord(chunk) || typeof chunk.type !== "string") return turn;
  const callId = typeof chunk.toolCallId === "string" ? chunk.toolCallId : null;
  switch (chunk.type) {
    case "text-start":
      // Each model step's text is its own part (a lead-in, a tool call, then the answer): keep
      // them apart by a blank line, so a part that opens with a heading still starts a line.
      return { ...turn, text: turn.text + partSeparator(turn.text) };
    case "text-delta":
      return typeof chunk.delta === "string" ? { ...turn, text: turn.text + chunk.delta } : turn;
    case "tool-input-start":
    case "tool-input-available": {
      if (callId === null || typeof chunk.toolName !== "string" || run.tools.has(callId)) {
        return turn;
      }
      run.tools.set(callId, turn.tools.length);
      return { ...turn, tools: [...turn.tools, { name: chunk.toolName, done: false }] };
    }
    case "tool-output-available":
    case "tool-output-error":
    case "tool-input-error":
    case "tool-output-denied": {
      const index = callId === null ? undefined : run.tools.get(callId);
      // A preliminary output is progress, not the end of the call.
      if (index === undefined || chunk.preliminary === true) return turn;
      return {
        ...turn,
        tools: turn.tools.map((tool, i) => (i === index ? { ...tool, done: true } : tool)),
      };
    }
    case "data-notice": {
      const { data } = chunk;
      if (!isRecord(data) || typeof data.text !== "string") return turn;
      if (typeof data.kind !== "string" || !NOTICE_KINDS.includes(data.kind)) return turn;
      const notice = { kind: data.kind, text: data.text } as AskNotice;
      return { ...turn, notices: [...turn.notices, notice] };
    }
    case "data-verification": {
      const { data } = chunk;
      if (!isRecord(data) || typeof data.checked !== "boolean") return turn;
      const list = data.unsupported;
      if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) return turn;
      return { ...turn, verification: { unsupported: list as string[], checked: data.checked } };
    }
    case "error":
      return { ...turn, failed: true };
    case "finish":
      run.sawFinish = true;
      return turn;
    default:
      return turn;
  }
}

/** The number in a response header, or null when it is missing or not a whole number. */
function headerCount(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  return raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

/** Why a non-2xx answer to POST /api/ask got no answer text. */
function errorOfStatus(response: Response): AskError {
  switch (response.status) {
    case 401:
      return { kind: "signed_out" };
    case 413:
      return { kind: "too_large" };
    case 429:
      return {
        kind: "rate_limited",
        used: headerCount(response, "x-ask-used"),
        limit: headerCount(response, "x-ask-limit"),
      };
    case 503:
      return { kind: "unavailable" };
    default:
      return { kind: "failed" };
  }
}

const userTurn = (id: string, text: string): Turn => ({
  id,
  role: "user",
  text,
  notices: [],
  verification: null,
  tools: [],
  streaming: false,
  failed: false,
  stopped: false,
});

const messagesOf = (turns: readonly Turn[]): ChatMessage[] =>
  turns.filter((turn) => turn.text !== "").map((turn) => ({ role: turn.role, content: turn.text }));

/**
 * What is kept on the device: the same, minus answers that broke off (the question stays), and
 * with stopped answers marked `partial` so a reload does not present them as finished.
 */
const storedOf = (turns: readonly Turn[]): ChatMessage[] =>
  turns
    .filter((turn) => !turn.failed && turn.text !== "")
    .map((turn) => ({
      role: turn.role,
      content: turn.text,
      ...(turn.stopped ? { partial: true as const } : {}),
    }));

/** One question in flight. A run that is no longer `current` is dead: it changes nothing. */
type Run = { controller: AbortController; assistantId: string };

/**
 * The Ask conversation. One question at a time: `send` is ignored while an answer streams. A
 * question that got no answer (HTTP error) leaves its user turn behind, and sending the same text
 * again reuses it; a broken answer (`failed`) is replaced the same way. The conversation is kept
 * on the device (text only) each time an answer settles, never while it streams.
 */
export function useAskChat(options: { fetchImpl?: typeof fetch } = {}): AskChat {
  const { settings } = useSettings();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<AskChat["status"]>("idle");
  const [error, setError] = useState<AskError | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  // The latest values, so the callbacks below stay stable and never read a stale render.
  const turnsRef = useRef<Turn[]>([]);
  const runRef = useRef<Run | null>(null);
  const aliveRef = useRef(false);
  const idCounter = useRef(0);
  const lensRef = useRef(settings.lens);
  lensRef.current = settings.lens;
  const fetchRef = useRef(options.fetchImpl);
  fetchRef.current = options.fetchImpl;

  const nextId = useCallback(() => `turn-${++idCounter.current}`, []);
  const commit = useCallback((next: Turn[]) => {
    turnsRef.current = next;
    if (aliveRef.current) setTurns(next);
  }, []);
  const isCurrent = useCallback((run: Run) => aliveRef.current && runRef.current === run, []);

  /** Ends the run: idle again, the answer kept (if it has text) on the device. */
  const settle = useCallback(
    (run: Run, outcome: { failed: boolean; stopped?: boolean }) => {
      runRef.current = null;
      if (!aliveRef.current) return;
      const next = turnsRef.current.map((turn) =>
        turn.id === run.assistantId
          ? {
              ...turn,
              streaming: false,
              failed: outcome.failed || turn.failed,
              // An answer that already broke off stays broken, whatever was pressed after.
              stopped: outcome.stopped === true && !(outcome.failed || turn.failed),
            }
          : turn,
      );
      commit(next);
      setStatus("idle");
      writeChat(storedOf(next));
    },
    [commit],
  );

  /** Ends the run with no answer: the empty assistant turn goes, the question stays. */
  const abandon = useCallback(
    (run: Run, nextError: AskError | null) => {
      runRef.current = null;
      if (!aliveRef.current) return;
      commit(turnsRef.current.filter((turn) => turn.id !== run.assistantId));
      setStatus("idle");
      if (nextError !== null) {
        setError(nextError);
        if (nextError.kind === "signed_out") setSignedOut(true);
      }
    },
    [commit],
  );

  const execute = useCallback(
    async (run: Run, body: AskBody) => {
      const doFetch = fetchRef.current ?? fetch;
      let response: Response;
      try {
        response = await doFetch(ASK_URL, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: run.controller.signal,
        });
      } catch {
        if (!isCurrent(run)) return;
        abandon(run, { kind: navigator.onLine === false ? "offline" : "failed" });
        return;
      }
      if (!isCurrent(run)) return;
      if (!response.ok) {
        abandon(run, errorOfStatus(response));
        return;
      }
      if (response.body === null) {
        abandon(run, { kind: "failed" });
        return;
      }

      const state: RunState = { tools: new Map(), sawFinish: false };
      let broke = false;
      try {
        for await (const chunk of readEvents(response.body)) {
          if (!isCurrent(run)) return;
          commit(
            turnsRef.current.map((turn) =>
              turn.id === run.assistantId ? applyChunk(turn, chunk, state) : turn,
            ),
          );
          // The answer is complete at `finish` (the verification comes before it); the server may
          // keep the body open while it cleans up, and that must not keep the answer "streaming".
          if (state.sawFinish) break;
        }
      } catch {
        if (!isCurrent(run)) return;
        broke = true;
      }
      if (!isCurrent(run)) return;
      // A stream that ends without `finish` was cut short.
      settle(run, { failed: broke || !state.sawFinish });
    },
    [abandon, commit, isCurrent, settle],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (text === "" || text.length > ASK_LIMITS.maxMessageChars || runRef.current !== null) {
        return;
      }
      let history = turnsRef.current;
      // Asking the same thing again after a failure is a retry: no second copy of the question.
      // A broken answer with no text at all goes whatever is asked (it says nothing).
      const last = history.at(-1);
      if (last?.role === "assistant" && last.failed) {
        const before = history.slice(0, -1);
        const sameQuestion = before.at(-1)?.role === "user" && before.at(-1)?.text === text;
        if (sameQuestion || last.text === "") history = before;
      }
      // A question left without an answer (HTTP error, stopped early) is reused when asked again
      // and dropped when something else is asked.
      const tail = history.at(-1);
      if (tail?.role === "user") {
        history = tail.text === text ? history : history.slice(0, -1);
      }
      if (history.at(-1)?.role !== "user" || history.at(-1)?.text !== text) {
        history = [...history, userTurn(nextId(), text)];
      }

      const assistantId = nextId();
      const run: Run = { controller: new AbortController(), assistantId };
      runRef.current = run;
      commit([...history, { ...userTurn(assistantId, ""), role: "assistant", streaming: true }]);
      setStatus("streaming");
      setError(null);
      setSignedOut(false);

      const body = buildAskBody({
        messages: messagesOf(history),
        lens: lensRef.current,
        holdings: readHoldings(),
        memory: readMemory(),
        plan: currentPlanRequest(readPlanOptIn()),
      });
      void execute(run, body);
    },
    [commit, execute, nextId],
  );

  const stop = useCallback(() => {
    const run = runRef.current;
    if (run === null) return;
    run.controller.abort();
    const turn = turnsRef.current.find((t) => t.id === run.assistantId);
    // No text yet: the turn goes, with any notices and tool chips, and the question stays.
    if (turn?.text === "") abandon(run, null);
    else settle(run, { failed: false, stopped: true });
  }, [abandon, settle]);

  const newChat = useCallback(() => {
    runRef.current?.controller.abort();
    runRef.current = null;
    commit([]);
    setStatus("idle");
    setError(null);
    setSignedOut(false);
    clearChat();
  }, [commit]);

  useEffect(() => {
    aliveRef.current = true;
    // Restored here, after hydration, so server and client markup agree.
    if (turnsRef.current.length === 0) {
      const stored = readChat();
      if (stored.length > 0) {
        commit(
          stored.map((m) => ({
            ...userTurn(nextId(), m.content),
            role: m.role,
            stopped: m.role === "assistant" && m.partial === true,
            restored: true as const,
          })),
        );
      }
    }
    return () => {
      aliveRef.current = false;
      runRef.current?.controller.abort();
      runRef.current = null;
    };
  }, [commit, nextId]);

  return { turns, status, error, send, stop, newChat, signedOut };
}
