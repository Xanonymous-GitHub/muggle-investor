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
 *
 * At the cap, a new address makes room by dropping an entry whose window has ended, else the entry
 * with the fewest failures (the oldest among ties), so a flood of spoofed addresses, each with one
 * failure, cannot push out an address that is already blocked. The O(n) scan (n <= cap) runs only
 * at the cap; the common path is O(1). Still best-effort: if every tracked address is blocked,
 * one of them must go, and without a trusted proxy the address itself can be spoofed.
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

  /** Frees one slot: an ended window first, else the fewest failures (oldest-inserted on ties). */
  const evictOne = (at: number): void => {
    let victim: string | undefined;
    let fewest = Number.POSITIVE_INFINITY;
    for (const [client, entry] of entries) {
      if (at - entry.openedAt >= windowMs) {
        victim = client;
        break;
      }
      if (entry.failures < fewest) {
        fewest = entry.failures;
        victim = client;
      }
    }
    if (victim !== undefined) entries.delete(victim);
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
      if (entries.size >= maxEntries) evictOne(at);
      entries.set(client, { failures: 1, openedAt: at });
    },
    size: () => entries.size,
  };
}
