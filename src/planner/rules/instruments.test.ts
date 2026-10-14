import { describe, expect, it } from "vitest";
import { CATEGORY_MEMBERS, ELIGIBILITY } from "./instruments";

describe("CATEGORY_MEMBERS", () => {
  it("lists the signed-off initial members", () => {
    expect(CATEGORY_MEMBERS.core).toEqual(["0050", "006208", "0051", "006203", "00922"]);
    expect(CATEGORY_MEMBERS.bond).toEqual([
      "00679B",
      "00687B",
      "00696B",
      "00720B",
      "00725B",
      "00751B",
      "00772B",
    ]);
    expect(CATEGORY_MEMBERS.dividend).toEqual([
      "0056",
      "00878",
      "00919",
      "00713",
      "00929",
      "00940",
      "00900",
      "00915",
      "00731",
    ]);
  });

  it("has no symbol in two categories or twice in one", () => {
    const all = Object.values(CATEGORY_MEMBERS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("ELIGIBILITY", () => {
  it("holds the signed-off thresholds", () => {
    expect(ELIGIBILITY.maxStaleDays).toBe(10);
    expect(ELIGIBILITY.minHistoryYears).toEqual({ core: 5, dividend: 5, bond: 3 });
    expect(ELIGIBILITY.minMedianTurnover).toBe(100_000_000);
    expect(ELIGIBILITY.recentDays).toBe(120);
  });

  it("excludes leveraged, inverse, futures, currency and commodity names", () => {
    for (const name of [
      "元大台灣50正2",
      "元大台灣50反1",
      "某某槓桿ETF",
      "美元計價債",
      "黃金期貨",
    ]) {
      expect(ELIGIBILITY.excludedNamePattern.test(name)).toBe(true);
    }
    for (const name of ["元大台灣50", "元大高股息", "元大美債20年"]) {
      expect(ELIGIBILITY.excludedNamePattern.test(name)).toBe(false);
    }
  });
});
