import { describe, expect, it } from "vitest";
import { createOnDemandBudget } from "./on-demand-budget";

describe("on-demand budget", () => {
  it("grants `limit` tokens per rolling window and never waits", () => {
    const budget = createOnDemandBudget({ limit: 2, windowMs: 60_000 });
    expect(budget.tryTake(0)).toEqual({ ok: true });
    expect(budget.tryTake(10_000)).toEqual({ ok: true });
    expect(budget.tryTake(20_000)).toEqual({ ok: false, retryAfterMs: 40_000 });
    // the oldest token expires at 60 s, the next at 70 s
    expect(budget.tryTake(60_000)).toEqual({ ok: true });
    expect(budget.tryTake(65_000)).toEqual({ ok: false, retryAfterMs: 5_000 });
    expect(budget.tryTake(70_000)).toEqual({ ok: true });
  });

  it("a denied attempt does not consume a token", () => {
    const budget = createOnDemandBudget({ limit: 1, windowMs: 1_000 });
    budget.tryTake(0);
    budget.tryTake(500);
    expect(budget.tryTake(1_000)).toEqual({ ok: true });
  });
});
