import type { Page } from "@playwright/test";

/**
 * What the page can be told about a stream chunk: the AI SDK UI-message-stream shapes
 * `POST /api/ask` sends (see `src/ui/ask/stream-fixture.ts` for the DOM-test equivalent).
 */
export type Chunk = { type: string; [key: string]: unknown };

type PageStream = {
  push(chunk: Chunk): void;
  close(): void;
  fail(): void;
  cancelled: boolean;
  aborted: boolean;
};

/** The harness the init script puts on `window`. */
type HarnessWindow = {
  __ask: {
    requests: unknown[];
    streams: PageStream[];
    /** Answered with this HTTP status, in order, before any stream is opened. */
    failures: number[];
  };
};

export type SeedOptions = {
  session?: "signed_in" | "signed_out";
  theme?: "light" | "dark";
  lens?: "beginner" | "pro";
  /** The first-use disclosure was agreed to (default true, so a question goes straight out). */
  ack?: boolean;
  /** Extra localStorage entries, written once per tab (a reload keeps what the page changed). */
  storage?: Record<string, string>;
};

/**
 * Makes the Ask screen run without a server: the session check is answered here, and `fetch` for
 * `/api/ask` returns a stream the test feeds by hand (`push`, `close`, `fail`), so slow, bursty
 * and interrupted answers are reproducible in every browser. Call before `page.goto`.
 */
export async function installAsk(page: Page, options: SeedOptions = {}): Promise<void> {
  const { session = "signed_in", theme = "light", lens = "beginner", ack = true } = options;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: session === "signed_in" ? 200 : 401, body: "{}" }),
  );
  const storage: Record<string, string> = {
    "muggle.settings.v1": JSON.stringify({ lens, theme }),
    ...(ack ? { "muggle.ask.ack.v1": JSON.stringify({ ack: true }) } : {}),
    ...options.storage,
  };
  await page.addInitScript((seed: Record<string, string>) => {
    try {
      if (!sessionStorage.getItem("e2e-seeded")) {
        sessionStorage.setItem("e2e-seeded", "1");
        for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
      }
    } catch {
      // storage blocked: the test that cares says so itself
    }
    const realFetch = window.fetch.bind(window);
    const state: HarnessWindow["__ask"] = { requests: [], streams: [], failures: [] };
    (window as unknown as HarnessWindow).__ask = state;
    const encoder = new TextEncoder();
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!new URL(url, location.href).pathname.endsWith("/api/ask")) return realFetch(input, init);
      state.requests.push(JSON.parse(String(init?.body ?? "null")));
      const status = state.failures.shift();
      if (status !== undefined) return Promise.resolve(new Response("{}", { status }));
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      let finished = false;
      const stream: PageStream = {
        cancelled: false,
        aborted: false,
        push(chunk) {
          if (!finished) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        },
        close() {
          if (finished) return;
          finished = true;
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
        fail() {
          if (finished) return;
          finished = true;
          controller.error(new TypeError("network error"));
        },
      };
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
        cancel() {
          stream.cancelled = true;
          finished = true;
        },
      });
      init?.signal?.addEventListener("abort", () => {
        stream.aborted = true;
        if (finished) return;
        finished = true;
        controller.error(new DOMException("aborted", "AbortError"));
      });
      state.streams.push(stream);
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
        }),
      );
    };
  }, storage);
}

/** Feeds chunks to the n-th stream the page opened (0 is the first question's). */
export async function push(page: Page, chunks: Chunk[], stream = 0): Promise<void> {
  await page.evaluate(
    ([n, list]) => {
      for (const chunk of list as Chunk[])
        (window as unknown as HarnessWindow).__ask.streams[n as number]?.push(chunk);
    },
    [stream, chunks] as const,
  );
}

export async function closeStream(page: Page, stream = 0): Promise<void> {
  await page.evaluate(
    (n) => (window as unknown as HarnessWindow).__ask.streams[n]?.close(),
    stream,
  );
}

export async function failStream(page: Page, stream = 0): Promise<void> {
  await page.evaluate((n) => (window as unknown as HarnessWindow).__ask.streams[n]?.fail(), stream);
}

/** The next question is refused with this HTTP status. */
export async function failNext(page: Page, status: number): Promise<void> {
  await page.evaluate((s) => (window as unknown as HarnessWindow).__ask.failures.push(s), status);
}

export async function requestCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__ask.requests.length);
}

export async function requestBody(page: Page, n: number): Promise<unknown> {
  return page.evaluate((i) => (window as unknown as HarnessWindow).__ask.requests[i], n);
}

export async function streamState(
  page: Page,
  n = 0,
): Promise<{ cancelled: boolean; aborted: boolean } | null> {
  return page.evaluate((i) => {
    const s = (window as unknown as HarnessWindow).__ask.streams[i];
    return s ? { cancelled: s.cancelled, aborted: s.aborted } : null;
  }, n);
}
