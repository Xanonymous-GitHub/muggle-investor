import { describe, expect, it } from "vitest";
import { ALLOCATION_TABLE, reserveMonthsFor } from "./allocation";

describe("ALLOCATION_TABLE", () => {
  it.each([1, 2, 3, 4, 5] as const)("level %i sums to 100", (level) => {
    const total = Object.values(ALLOCATION_TABLE[level]).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it("matches the signed-off table", () => {
    expect(ALLOCATION_TABLE).toEqual({
      1: { core: 15, bond: 55, dividend: 15, satellite: 0, cash: 15 },
      2: { core: 30, bond: 40, dividend: 20, satellite: 0, cash: 10 },
      3: { core: 45, bond: 25, dividend: 20, satellite: 5, cash: 5 },
      4: { core: 60, bond: 10, dividend: 20, satellite: 10, cash: 0 },
      5: { core: 70, bond: 0, dividend: 15, satellite: 15, cash: 0 },
    });
  });
});

describe("reserveMonthsFor", () => {
  it("maps income stability to reserve months", () => {
    expect(reserveMonthsFor("income-stable")).toBe(3);
    expect(reserveMonthsFor("income-fluctuating")).toBe(6);
    expect(reserveMonthsFor("income-unstable")).toBe(9);
  });

  it("throws on an unknown option id", () => {
    expect(() => reserveMonthsFor("income-???")).toThrow();
  });
});
