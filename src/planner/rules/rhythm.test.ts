import { describe, expect, it } from "vitest";
import { trancheMonthsFor } from "./rhythm";

describe("trancheMonthsFor", () => {
  it.each([1, 2, 3] as const)("level %i stages over 6 months", (level) => {
    expect(trancheMonthsFor(level, 600_000, 20_000)).toBe(6);
  });

  it.each([4, 5] as const)("level %i stages over 3 months", (level) => {
    expect(trancheMonthsFor(level, 600_000, 20_000)).toBe(3);
  });

  it("does not stage when the lump is below 3x the monthly amount", () => {
    expect(trancheMonthsFor(2, 50_000, 20_000)).toBe(1);
    expect(trancheMonthsFor(5, 59_999, 20_000)).toBe(1);
  });

  it("stages when the lump is exactly 3x the monthly amount", () => {
    expect(trancheMonthsFor(2, 60_000, 20_000)).toBe(6);
  });
});
