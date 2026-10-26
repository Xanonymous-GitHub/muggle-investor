export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A non-blocking caller found no token left in the current window. */
export class LimiterBusyError extends Error {
  override readonly name = "LimiterBusyError";

  constructor() {
    super("rate limit reached for this window");
  }
}

export type RateLimiter = {
  /** Takes a token, waiting for the next window when the bucket is empty. */
  acquire(): Promise<void>;
  /**
   * Takes a token only if one is available right now; never waits. Synchronous for a limiter in
   * this process, a promise for one that asks a shared store: `await` the result.
   */
  tryAcquire(): boolean | Promise<boolean>;
};

/** One attempt to take a token from a store shared between processes. */
export type SharedTake = () => Promise<{ ok: true } | { ok: false; retryAfterMs: number }>;

export type RateLimiterOptions = {
  /** Requests allowed per window. */
  capacity: number;
  /** Window length: the bucket refills to full this long after the window opened. */
  refillEveryMs: number;
  /**
   * Millisecond clock. Default `performance.now()`: monotonic, so a wall-clock jump cannot
   * refill the bucket early.
   */
  now?: () => number;
  sleep?: Sleep;
};

/**
 * Fixed-window token bucket matching the upstream's "N requests per window" limit.
 * A window opens on the first acquire after the previous one ended; the bucket then
 * refills to full once `refillEveryMs` has elapsed.
 */
export const createRateLimiter = ({
  capacity,
  refillEveryMs,
  now = () => performance.now(),
  sleep = defaultSleep,
}: RateLimiterOptions): RateLimiter => {
  if (!(capacity >= 1)) throw new RangeError("capacity must be at least 1");
  if (!(refillEveryMs > 0)) throw new RangeError("refillEveryMs must be positive");

  let tokens = capacity;
  let windowStart: number | null = null;

  /** Takes a token if one is left at `current`; otherwise returns the ms until the refill. */
  const take = (current: number): number | null => {
    if (windowStart === null || current - windowStart >= refillEveryMs) {
      windowStart = current;
      tokens = capacity;
    }
    if (tokens > 0) {
      tokens -= 1;
      return null;
    }
    return windowStart + refillEveryMs - current;
  };

  const acquire = async (): Promise<void> => {
    for (;;) {
      const wait = take(now());
      if (wait === null) return;
      await sleep(wait);
    }
  };

  const tryAcquire = (): boolean => take(now()) === null;

  return { acquire, tryAcquire };
};

/**
 * A limiter whose budget lives in a store that every app instance shares (see
 * `takeRateLimitToken`), for an upstream quota that holds across pods. `take` is injected so this
 * module needs no database. A `take` that throws rejects `acquire` / `tryAcquire`: when the store
 * cannot be reached the quota is unknown, and no token is granted.
 */
export const createSharedRateLimiter = ({
  take,
  sleep = defaultSleep,
}: {
  take: SharedTake;
  sleep?: Sleep;
}): RateLimiter => {
  const acquire = async (): Promise<void> => {
    for (;;) {
      const result = await take();
      if (result.ok) return;
      await sleep(result.retryAfterMs);
    }
  };

  const tryAcquire = async (): Promise<boolean> => (await take()).ok;

  return { acquire, tryAcquire };
};
