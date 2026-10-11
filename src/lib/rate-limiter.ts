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
  /** Takes a token only if one is available right now; never waits. */
  tryAcquire(): boolean;
};

export type RateLimiterOptions = {
  /** Requests allowed per window. */
  capacity: number;
  /** Window length: the bucket refills to full this long after the window opened. */
  refillEveryMs: number;
  /** Millisecond clock. Default `performance.now()`: monotonic, so wall-clock jumps do not refill early. */
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
