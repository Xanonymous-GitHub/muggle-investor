export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type RateLimiter = { acquire(): Promise<void> };

export type RateLimiterOptions = {
  /** Requests allowed per window. */
  capacity: number;
  /** Window length: the bucket refills to full this long after the window opened. */
  refillEveryMs: number;
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
  now = Date.now,
  sleep = defaultSleep,
}: RateLimiterOptions): RateLimiter => {
  if (!(capacity >= 1)) throw new RangeError("capacity must be at least 1");
  if (!(refillEveryMs > 0)) throw new RangeError("refillEveryMs must be positive");

  let tokens = capacity;
  let windowStart: number | null = null;

  const acquire = async (): Promise<void> => {
    for (;;) {
      const current = now();
      if (windowStart === null || current - windowStart >= refillEveryMs) {
        windowStart = current;
        tokens = capacity;
      }
      if (tokens > 0) {
        tokens -= 1;
        return;
      }
      await sleep(windowStart + refillEveryMs - current);
    }
  };

  return { acquire };
};
