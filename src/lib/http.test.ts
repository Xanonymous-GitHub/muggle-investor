import { describe, expect, it } from "vitest";
import { fetchWithRetry, HttpError } from "./http";

const URL_WITH_KEY = "https://stocks.example.com/SECRET123/report";
const redact = (url: string) => url.replace("SECRET123", "***");

/** Fetch stub that replays the given outcomes in order and records calls. */
const scriptedFetch = (outcomes: Array<Response | Error>) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = outcomes[calls.length - 1];
    if (next === undefined) throw new Error("fetch called more often than scripted");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
};

const recorder = () => {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
};

const status = (code: number, headers?: Record<string, string>) =>
  new Response(null, { status: code, headers });

describe("fetchWithRetry", () => {
  it("returns a successful response without sleeping", async () => {
    const { fetchImpl } = scriptedFetch([new Response("ok")]);
    const { sleep, sleeps } = recorder();
    const res = await fetchWithRetry(URL_WITH_KEY, { fetchImpl, sleep });
    expect(await res.text()).toBe("ok");
    expect(sleeps).toEqual([]);
  });

  it("retries 503, 503, 200 with exponential backoff 500 then 1000", async () => {
    const { fetchImpl, calls } = scriptedFetch([status(503), status(503), new Response("ok")]);
    const { sleep, sleeps } = recorder();
    const res = await fetchWithRetry(URL_WITH_KEY, { fetchImpl, sleep });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("honours retry-after seconds on 429", async () => {
    const { fetchImpl } = scriptedFetch([status(429, { "retry-after": "2" }), new Response("ok")]);
    const { sleep, sleeps } = recorder();
    await fetchWithRetry(URL_WITH_KEY, { fetchImpl, sleep });
    expect(sleeps).toEqual([2000]);
  });

  it("falls back to backoff when 429 has no usable retry-after", async () => {
    const { fetchImpl } = scriptedFetch([
      status(429),
      status(429, { "retry-after": "soon" }),
      new Response("ok"),
    ]);
    const { sleep, sleeps } = recorder();
    await fetchWithRetry(URL_WITH_KEY, { fetchImpl, sleep });
    expect(sleeps).toEqual([500, 1000]);
  });

  it("retries network errors and succeeds", async () => {
    const { fetchImpl } = scriptedFetch([new TypeError("fetch failed"), new Response("ok")]);
    const { sleep, sleeps } = recorder();
    const res = await fetchWithRetry(URL_WITH_KEY, { fetchImpl, sleep });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([500]);
  });

  it("throws immediately on 404 with no retry", async () => {
    const { fetchImpl, calls } = scriptedFetch([status(404)]);
    const { sleep, sleeps } = recorder();
    const error = await fetchWithRetry(URL_WITH_KEY, { fetchImpl, sleep, redact }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("gives up after the retry budget and reports the last status", async () => {
    const { fetchImpl, calls } = scriptedFetch([status(500), status(500), status(502)]);
    const { sleep, sleeps } = recorder();
    const error = await fetchWithRetry(URL_WITH_KEY, {
      fetchImpl,
      sleep,
      retries: 2,
      baseDelayMs: 100,
      redact,
    }).catch((e: unknown) => e);
    expect((error as HttpError).status).toBe(502);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("throws status null after exhausting retries on network errors", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      new TypeError("boom"),
      new TypeError("boom"),
      new TypeError("boom"),
      new TypeError("boom"),
    ]);
    const { sleep } = recorder();
    const error = await fetchWithRetry(URL_WITH_KEY, { fetchImpl, sleep, redact }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBeNull();
    expect(calls).toHaveLength(4);
  });

  it("never leaks the raw URL: url and message use redact", async () => {
    const { fetchImpl } = scriptedFetch([status(404)]);
    const { sleep } = recorder();
    const error = (await fetchWithRetry(URL_WITH_KEY, { fetchImpl, sleep, redact }).catch(
      (e: unknown) => e,
    )) as HttpError;
    expect(error.url).toBe("https://stocks.example.com/***/report");
    expect(error.message).toContain("https://stocks.example.com/***/report");
    expect(error.message).not.toContain("SECRET123");
  });

  it("does not leak the URL through network error messages", async () => {
    const { fetchImpl } = scriptedFetch([new TypeError(`failed to reach ${URL_WITH_KEY}`)]);
    const { sleep } = recorder();
    const error = (await fetchWithRetry(URL_WITH_KEY, {
      fetchImpl,
      sleep,
      retries: 0,
      redact,
    }).catch((e: unknown) => e)) as HttpError;
    expect(error.message).not.toContain("SECRET123");
    expect(JSON.stringify(error)).not.toContain("SECRET123");
    expect(error.cause).toBeUndefined();
  });

  it("passes a timeout signal and strips retry options from the fetch init", async () => {
    const { fetchImpl, calls } = scriptedFetch([new Response("ok")]);
    await fetchWithRetry(URL_WITH_KEY, {
      fetchImpl,
      sleep: async () => {},
      headers: { accept: "text/html" },
    });
    const init = calls[0]?.init as Record<string, unknown>;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ accept: "text/html" });
    expect(init).not.toHaveProperty("retries");
    expect(init).not.toHaveProperty("fetchImpl");
    expect(init).not.toHaveProperty("redact");
  });

  it("treats a timeout as a retryable network error", async () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    const { fetchImpl, calls } = scriptedFetch([timeout, new Response("ok")]);
    const { sleep, sleeps } = recorder();
    const res = await fetchWithRetry(URL_WITH_KEY, { fetchImpl, sleep });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([500]);
  });

  it("reports a timeout distinctly once retries are exhausted", async () => {
    const timeout = () => new DOMException("The operation timed out.", "TimeoutError");
    const { fetchImpl } = scriptedFetch([timeout()]);
    const error = (await fetchWithRetry(URL_WITH_KEY, {
      fetchImpl,
      sleep: async () => {},
      retries: 0,
      redact,
    }).catch((e: unknown) => e)) as HttpError;
    expect(error.status).toBeNull();
    expect(error.message).toBe("Request timed out for https://stocks.example.com/***/report");
  });

  it("does not retry when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl, calls } = scriptedFetch([new DOMException("aborted", "AbortError")]);
    const { sleep, sleeps } = recorder();
    const error = await fetchWithRetry(URL_WITH_KEY, {
      fetchImpl,
      sleep,
      signal: controller.signal,
      redact,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});
