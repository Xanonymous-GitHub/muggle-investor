export type BudgetDecision = { ok: true } | { ok: false; retryAfterMs: number };

export interface OnDemandBudget {
  /** Takes a token if one is left in the rolling window ending at `nowMs`. Never waits. */
  tryTake(nowMs: number): BudgetDecision;
}

/**
 * Rolling-window token budget for upstream calls triggered by user requests. It is checked
 * before (and independently of) the shared darkfanxing limiter, so a burst of on-demand
 * requests is refused up front instead of queueing behind, and starving, scheduled ingestion.
 */
export function createOnDemandBudget({
  limit,
  windowMs,
}: {
  limit: number;
  windowMs: number;
}): OnDemandBudget {
  const taken: number[] = [];
  return {
    tryTake(nowMs) {
      while (taken.length > 0 && (taken[0] as number) <= nowMs - windowMs) taken.shift();
      if (taken.length >= limit) {
        return { ok: false, retryAfterMs: (taken[0] as number) + windowMs - nowMs };
      }
      taken.push(nowMs);
      return { ok: true };
    },
  };
}
