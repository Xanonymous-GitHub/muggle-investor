// Test helper: responses whose body is an AI SDK UI message stream (Server-Sent Events, one
// `data: <json>` event per chunk, ending with `data: [DONE]`), like POST /api/ask sends.

export type StreamChunk = { type: string; [key: string]: unknown };

const encoder = new TextEncoder();

/** The wire text of one chunk. */
export const sseEvent = (chunk: StreamChunk | "[DONE]", eol = "\n"): string =>
  `data: ${chunk === "[DONE]" ? chunk : JSON.stringify(chunk)}${eol}${eol}`;

/** `start`, one text part split into `deltas`, then `finish`: the shape of a plain answer. */
export function textChunks(...deltas: string[]): StreamChunk[] {
  return [
    { type: "start" },
    { type: "text-start", id: "t1" },
    ...deltas.map((delta) => ({ type: "text-delta", id: "t1", delta })),
    { type: "text-end", id: "t1" },
  ];
}

export const finishChunk: StreamChunk = { type: "finish", finishReason: "stop" };

const SSE_HEADERS = { "content-type": "text/event-stream", "cache-control": "no-store" };

/**
 * A complete answer. `bytesPerRead` re-slices the encoded stream into reads of that many bytes
 * (cutting events and multi-byte characters anywhere), `eol` picks the line ending.
 */
export function uiStreamResponse(
  chunks: StreamChunk[],
  opts: { bytesPerRead?: number; eol?: string; done?: boolean; status?: number } = {},
): Response {
  const { bytesPerRead, eol = "\n", done = true, status = 200 } = opts;
  const text =
    chunks.map((chunk) => sseEvent(chunk, eol)).join("") + (done ? sseEvent("[DONE]", eol) : "");
  const bytes = encoder.encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const size = bytesPerRead ?? bytes.length;
      for (let at = 0; at < bytes.length; at += size) {
        controller.enqueue(bytes.slice(at, at + size));
      }
      controller.close();
    },
  });
  return new Response(body, { status, headers: SSE_HEADERS });
}

export type ControlledStream = {
  response: Response;
  push(chunk: StreamChunk): void;
  close(): void;
  /** Errors the body the way a dropped connection does. */
  fail(error?: unknown): void;
  /** Whether the reader cancelled the body (it stopped reading). */
  readonly cancelled: boolean;
};

/**
 * A stream the test feeds by hand. Passing the request's `signal` makes an abort error the body,
 * which is what a real fetch does.
 */
export function controlledStream(signal?: AbortSignal | null): ControlledStream {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let finished = false;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
      finished = true;
    },
  });
  const fail = (error: unknown = new TypeError("network error")) => {
    if (finished) return;
    finished = true;
    controller.error(error);
  };
  signal?.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")));
  return {
    response: new Response(body, { status: 200, headers: SSE_HEADERS }),
    push(chunk) {
      if (!finished) controller.enqueue(encoder.encode(sseEvent(chunk)));
    },
    close() {
      if (finished) return;
      finished = true;
      controller.enqueue(encoder.encode(sseEvent("[DONE]")));
      controller.close();
    },
    fail,
    get cancelled() {
      return cancelled;
    },
  };
}
