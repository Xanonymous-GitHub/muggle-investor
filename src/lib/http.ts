import { defaultSleep, type Sleep } from "./rate-limiter";

export class HttpError extends Error {
  override readonly name = "HttpError";

  constructor(
    /** HTTP status, or null when no response was received (network error, timeout, abort). */
    readonly status: number | null,
    /** Already redacted; the raw URL may contain a secret and must never be stored here. */
    readonly url: string,
    reason: string,
  ) {
    super(`${reason} for ${url}`);
  }
}

export type FetchWithRetryInit = RequestInit & {
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  /** Delay before the first retry; doubles on each further retry. Default 500. */
  baseDelayMs?: number;
  /** Per-attempt timeout. A timeout counts as a (retryable) network error. Default 15000. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  /** Maps the URL to a loggable form; applied to every error. Default: identity. */
  redact?: (url: string) => string;
  /**
   * Runs before every attempt, the first and each retry (e.g. take a rate-limit token per
   * upstream call). Whatever it throws propagates unchanged and no request is made.
   */
  beforeAttempt?: () => Promise<void>;
};

/** Longest `retry-after` we wait out; a server asking for more fails the request instead. */
export const MAX_RETRY_AFTER_MS = 60_000;

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

/** `retry-after` in whole/decimal seconds -> ms; null for absent or non-numeric (e.g. HTTP-date). */
const retryAfterMs = (response: Response): number | null => {
  const header = response.headers.get("retry-after");
  if (header === null || header.trim() === "") return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
};

/**
 * fetch with retry on network errors, timeouts, 429 and 5xx. Other non-2xx statuses
 * throw immediately. Every failure is an HttpError carrying only the redacted URL;
 * the underlying error is deliberately not attached because its message can embed the raw URL.
 */
export const fetchWithRetry = async (
  url: string,
  {
    retries = 3,
    baseDelayMs = 500,
    timeoutMs = 15_000,
    fetchImpl = fetch,
    sleep = defaultSleep,
    redact = (value) => value,
    beforeAttempt,
    signal: callerSignal,
    ...init
  }: FetchWithRetryInit = {},
): Promise<Response> => {
  const safeUrl = redact(url);

  for (let attempt = 0; ; attempt++) {
    await beforeAttempt?.();
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    let response: Response | null = null;
    let failure: HttpError;
    try {
      response = await fetchImpl(url, { ...init, signal });
      if (response.ok) return response;
      failure = new HttpError(response.status, safeUrl, `HTTP ${response.status}`);
    } catch (error) {
      if (callerSignal?.aborted) throw new HttpError(null, safeUrl, "Request aborted");
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      failure = new HttpError(null, safeUrl, timedOut ? "Request timed out" : "Network error");
    }

    const retryable = response === null || isRetryableStatus(response.status);
    if (!retryable || attempt >= retries) {
      await response?.body?.cancel();
      throw failure;
    }

    await response?.body?.cancel();
    const requested = response && retryAfterMs(response);
    if (response && requested !== null && requested > MAX_RETRY_AFTER_MS) {
      // Waiting that long would hold the caller (and a setTimeout >= 2^31 ms misfires at once).
      throw new HttpError(
        response.status,
        safeUrl,
        `HTTP ${response.status} with retry-after over ${MAX_RETRY_AFTER_MS / 1000}s`,
      );
    }
    await sleep(requested ?? baseDelayMs * 2 ** attempt);
  }
};
