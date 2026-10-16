import { describe, expect, it } from "vitest";
import { type AmountInput, planAmounts, splitByLargestRemainder } from "./amounts";
import { ALLOCATION_TABLE, type Slice } from "./rules/allocation";

const LEVEL_3 = ALLOCATION_TABLE[3];
const sum = (slices: Record<Slice, number>) => Object.values(slices).reduce((a, b) => a + b, 0);

describe("splitByLargestRemainder", () => {
  it("splits exactly when the total divides evenly", () => {
    expect(splitByLargestRemainder(100000, LEVEL_3)).toEqual({
      core: 45000,
      bond: 25000,
      dividend: 20000,
      satellite: 5000,
      cash: 5000,
    });
  });

  it("gives the extra unit to the largest remainder", () => {
    expect(splitByLargestRemainder(100001, LEVEL_3)).toEqual({
      core: 45001,
      bond: 25000,
      dividend: 20000,
      satellite: 5000,
      cash: 5000,
    });
  });

  it("sums to the total for a tiny amount", () => {
    const out = splitByLargestRemainder(7, LEVEL_3);
    expect(sum(out)).toBe(7);
    expect(out).toEqual({ core: 3, bond: 2, dividend: 2, satellite: 0, cash: 0 });
  });

  it("breaks ties in Slice order", () => {
    // Bond and cash tie on the remainder; bond comes first in Slice order.
    expect(
      splitByLargestRemainder(1, { core: 0, bond: 50, dividend: 0, satellite: 0, cash: 50 }),
    ).toEqual({
      core: 0,
      bond: 1,
      dividend: 0,
      satellite: 0,
      cash: 0,
    });
  });

  it("returns zeros for a zero total", () => {
    expect(sum(splitByLargestRemainder(0, LEVEL_3))).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects total %s", (total) => {
    expect(() => splitByLargestRemainder(total, LEVEL_3)).toThrow(RangeError);
  });

  it("rejects weights that sum to zero", () => {
    expect(() =>
      splitByLargestRemainder(10, { core: 0, bond: 0, dividend: 0, satellite: 0, cash: 0 }),
    ).toThrow(RangeError);
  });
});

const base: AmountInput = {
  lump: 500000,
  monthly: 10000,
  monthlyExpenses: 30000,
  existingReserve: 50000,
  incomeOptionId: "income-stable",
  level: 3,
};

describe("planAmounts", () => {
  it("fills the reserve gap from the lump and allocates the rest", () => {
    const plan = planAmounts(base);
    expect(plan.reserveTarget).toBe(90000);
    expect(plan.reserveGap).toBe(40000);
    expect(plan.investable).toBe(460000);
    expect(plan.reserveOnly).toBe(false);
    expect(plan.monthsToFillReserve).toBe(0);
    expect(sum(plan.slices)).toBe(460000);
    expect(plan.slices).toEqual(splitByLargestRemainder(460000, LEVEL_3));
  });

  it("returns the integer-percent weights the slices were split by", () => {
    expect(planAmounts(base).weights).toEqual(LEVEL_3);
    // A reserve-only plan carries the level's table row too, so every response has the field.
    expect(planAmounts({ ...base, existingReserve: 0, lump: 60000 }).weights).toEqual(LEVEL_3);
  });

  it("allocates everything when the reserve is already full", () => {
    const plan = planAmounts({ ...base, existingReserve: 200000 });
    expect(plan.reserveGap).toBe(0);
    expect(plan.investable).toBe(500000);
    expect(plan.reserveOnly).toBe(false);
  });

  it("is reserve-only when the lump cannot cover the gap", () => {
    const plan = planAmounts({ ...base, existingReserve: 0, lump: 60000 });
    expect(plan.reserveGap).toBe(90000);
    expect(plan.investable).toBe(0);
    expect(plan.reserveOnly).toBe(true);
    expect(sum(plan.slices)).toBe(0);
    expect(plan.monthsToFillReserve).toBe(3);
  });

  it("returns null months when a gap remains and monthly is 0", () => {
    const plan = planAmounts({ ...base, existingReserve: 0, lump: 60000, monthly: 0 });
    expect(plan.reserveOnly).toBe(true);
    expect(plan.monthsToFillReserve).toBeNull();
  });

  it("is reserve-only with no lump sum and a gap", () => {
    const plan = planAmounts({ ...base, existingReserve: 0, lump: 0 });
    expect(plan.reserveOnly).toBe(true);
    expect(plan.monthsToFillReserve).toBe(9);
    expect(sum(plan.slices)).toBe(0);
  });

  it("is not reserve-only with no lump sum and no gap", () => {
    const plan = planAmounts({ ...base, existingReserve: 90000, lump: 0 });
    expect(plan.reserveOnly).toBe(false);
    expect(plan.investable).toBe(0);
    expect(plan.monthsToFillReserve).toBe(0);
  });

  it("treats a lump that exactly covers the gap as reserve-only with nothing left", () => {
    const plan = planAmounts({ ...base, existingReserve: 0, lump: 90000 });
    expect(plan.investable).toBe(0);
    expect(plan.reserveOnly).toBe(true);
    expect(plan.monthsToFillReserve).toBe(0);
  });

  it("uses 9 months for unstable income", () => {
    expect(planAmounts({ ...base, incomeOptionId: "income-unstable" }).reserveTarget).toBe(270000);
  });

  it("follows the rhythm rule for tranche months", () => {
    expect(planAmounts({ ...base, level: 3 }).trancheMonths).toBe(6);
    expect(planAmounts({ ...base, level: 4 }).trancheMonths).toBe(3);
    expect(
      planAmounts({ ...base, lump: 100000, existingReserve: 90000, monthly: 50000 }).trancheMonths,
    ).toBe(1);
  });

  it("applies the rhythm rule to the investable amount, not the lump (R-P3)", () => {
    // Lump 100000 covers the 40000 gap; 60000 is under 3 x 30000, so no staging.
    const plan = planAmounts({ ...base, lump: 100000, monthly: 30000 });
    expect(plan.reserveGap).toBe(40000);
    expect(plan.investable).toBe(60000);
    expect(plan.trancheMonths).toBe(1);
  });

  it("uses one tranche when nothing is investable, even with no monthly amount", () => {
    const reserveOnly = planAmounts({ ...base, existingReserve: 0, lump: 60000, monthly: 0 });
    expect(reserveOnly.investable).toBe(0);
    expect(reserveOnly.trancheMonths).toBe(1);
    const empty = planAmounts({ ...base, existingReserve: 90000, lump: 0, monthly: 0 });
    expect(empty.trancheMonths).toBe(1);
  });

  it("rejects invalid money inputs", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planAmounts({ ...base, lump: bad })).toThrow(RangeError);
      expect(() => planAmounts({ ...base, monthly: bad })).toThrow(RangeError);
      expect(() => planAmounts({ ...base, monthlyExpenses: bad })).toThrow(RangeError);
      expect(() => planAmounts({ ...base, existingReserve: bad })).toThrow(RangeError);
    }
  });
});
