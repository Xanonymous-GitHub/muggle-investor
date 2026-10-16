// Server-only: slows invite-code guessing from one address.

export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 10 * 60 * 1000;
/** Hard cap on tracked addresses, so rotating spoofed addresses cannot grow memory. */
export const MAX_TRACKED_CLIENTS = 5000;

export type ThrottleVerdict = { blocked: false } | { blocked: true; retryAfterSeconds: number };

export type InviteThrottle = {
  /** Whether this address already used up its failures in the current window. Consumes nothing. */
  check(client: string): ThrottleVerdict;
  /** Counts one wrong code for this address. Only failures are ever counted. */
  recordFailure(client: string): void;
  size(): number;
};

type Entry = { failures: number; openedAt: number };

/**
 * Failed attempts per client address, in a fixed window that opens at the address's first failure.
 * Fixed rather than sliding: failures just before and just after a boundary can add up to twice
 * the limit, which is fine for slowing guessing. In memory, so the limit is per server process.
 * When the cap is reached the oldest-inserted address is dropped (O(1): Map keeps insertion order).
 */
export function createInviteThrottle(
  options: {
    now?: () => number;
    maxFailures?: number;
    windowMs?: number;
    maxEntries?: number;
  } = {},
): InviteThrottle {
  const {
    now = () => Date.now(),
    maxFailures = MAX_FAILURES,
    windowMs = FAILURE_WINDOW_MS,
    maxEntries = MAX_TRACKED_CLIENTS,
  } = options;
  const entries = new Map<string, Entry>();

  const live = (client: string, at: number): Entry | undefined => {
    const entry = entries.get(client);
    return entry && at - entry.openedAt < windowMs ? entry : undefined;
  };

  return {
    check(client) {
      const at = now();
      const entry = live(client, at);
      if (!entry || entry.failures < maxFailures) return { blocked: false };
      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.openedAt + windowMs - at) / 1000)),
      };
    },
    recordFailure(client) {
      const at = now();
      const entry = live(client, at);
      if (entry) {
        entry.failures += 1;
        return;
      }
      // New or expired: (re)insert so insertion order tracks when the window opened.
      entries.delete(client);
      if (entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      entries.set(client, { failures: 1, openedAt: at });
    },
    size: () => entries.size,
  };
}
