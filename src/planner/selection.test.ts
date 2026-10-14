import { describe, expect, it } from "vitest";
import type { EtfUniverseRow } from "@/db/repositories/etf-universe";
import type { PriceStats } from "@/db/repositories/prices";
import {
  type Candidate,
  discoverCandidates,
  isEligible,
  medianTurnover,
  selectInstruments,
} from "./selection";

const AS_OF = "2026-10-14";

/** UTC day arithmetic on a YYYY-MM-DD string. */
const shiftDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const GOOD_TURNOVER = 200_000_000;
const stats = (s: Partial<PriceStats> & { historyDays?: number; staleDays?: number } = {}) => {
  const { historyDays = 6000, staleDays = 0, ...rest } = s;
  return {
    firstDate: shiftDays(AS_OF, -historyDays),
    lastDate: shiftDays(AS_OF, -staleDays),
    barCount: 1000,
    recentTurnovers: [GOOD_TURNOVER],
    ...rest,
  } satisfies PriceStats;
};
const candidate = (
  symbol: string,
  s: Parameters<typeof stats>[0] = {},
  name = `${symbol} ETF`,
): Candidate => ({ symbol, name, stats: stats(s) });

describe("medianTurnover", () => {
  it("returns the middle value of an odd count regardless of order", () => {
    expect(medianTurnover(stats({ recentTurnovers: [5, 1, 3] }))).toBe(3);
  });

  it("averages the two middle values of an even count", () => {
    expect(medianTurnover(stats({ recentTurnovers: [4, 1, 3, 2] }))).toBe(2.5);
  });

  it("is 0 for an empty list", () => {
    expect(medianTurnover(stats({ recentTurnovers: [] }))).toBe(0);
  });

  it("does not mutate the input", () => {
    const recentTurnovers = [3, 1, 2];
    medianTurnover(stats({ recentTurnovers }));
    expect(recentTurnovers).toEqual([3, 1, 2]);
  });
});

describe("isEligible", () => {
  it("passes a long, fresh, liquid instrument", () => {
    expect(isEligible("core", candidate("0050"), AS_OF)).toEqual([]);
  });

  it("reports stale, short_history, low_turnover and excluded_name together", () => {
    const bad = candidate(
      "00999",
      { historyDays: 100, staleDays: 30, recentTurnovers: [1_000] },
      "某某正2",
    );
    expect(isEligible("core", bad, AS_OF)).toEqual([
      "stale",
      "short_history",
      "low_turnover",
      "excluded_name",
    ]);
  });

  it("accepts a last price exactly 10 days old and rejects 11", () => {
    expect(isEligible("core", candidate("A", { staleDays: 10 }), AS_OF)).toEqual([]);
    expect(isEligible("core", candidate("A", { staleDays: 11 }), AS_OF)).toEqual(["stale"]);
  });

  it("requires 5 years (365.25-day) for core and dividend", () => {
    // 5 years = 1826.25 days, so 1827 days is the shortest whole-day history that passes.
    expect(isEligible("core", candidate("A", { historyDays: 1827 }), AS_OF)).toEqual([]);
    expect(isEligible("core", candidate("A", { historyDays: 1826 }), AS_OF)).toEqual([
      "short_history",
    ]);
    expect(isEligible("dividend", candidate("A", { historyDays: 1827 }), AS_OF)).toEqual([]);
    expect(isEligible("dividend", candidate("A", { historyDays: 1826 }), AS_OF)).toEqual([
      "short_history",
    ]);
  });

  it("requires 3 years for bonds", () => {
    // 3 years = 1095.75 days.
    expect(isEligible("bond", candidate("A", { historyDays: 1096 }), AS_OF)).toEqual([]);
    expect(isEligible("bond", candidate("A", { historyDays: 1095 }), AS_OF)).toEqual([
      "short_history",
    ]);
    expect(isEligible("core", candidate("A", { historyDays: 1096 }), AS_OF)).toEqual([
      "short_history",
    ]);
  });

  it("accepts a median turnover of exactly 100,000,000 and rejects less", () => {
    expect(isEligible("core", candidate("A", { recentTurnovers: [100_000_000] }), AS_OF)).toEqual(
      [],
    );
    expect(isEligible("core", candidate("A", { recentTurnovers: [99_999_999] }), AS_OF)).toEqual([
      "low_turnover",
    ]);
  });

  it("judges liquidity on the median, not the mean or the bar count", () => {
    const spiky = candidate("A", { recentTurnovers: [1, 1, 1, 1, 9_000_000_000] });
    expect(isEligible("core", spiky, AS_OF)).toEqual(["low_turnover"]);
    // fewer bars than the recent window still pass when the median meets the threshold
    const short = candidate("A", { recentTurnovers: [150_000_000, 150_000_000] });
    expect(isEligible("core", short, AS_OF)).toEqual([]);
  });

  it("treats an empty turnover list as low_turnover", () => {
    expect(isEligible("core", candidate("A", { recentTurnovers: [] }), AS_OF)).toEqual([
      "low_turnover",
    ]);
  });

  it("rejects an excluded name even with perfect stats", () => {
    for (const name of ["元大S&P原油正2", "富邦VIX", "國泰美元指數", "XX黃金ETN"]) {
      expect(isEligible("core", candidate("A", {}, name), AS_OF)).toEqual(["excluded_name"]);
    }
  });
});

describe("selectInstruments", () => {
  it("makes the longest-history eligible core member primary and the next the alternate", () => {
    const result = selectInstruments(
      [candidate("0050", { historyDays: 7300 }), candidate("006208", { historyDays: 3650 })],
      AS_OF,
    );
    expect(result.core.primary?.symbol).toBe("0050");
    expect(result.core.alternate?.symbol).toBe("006208");
    expect(result.core.rejected).toEqual([]);
  });

  it("orders by history even when the shorter one is listed first", () => {
    const result = selectInstruments(
      [candidate("0050", { historyDays: 3650 }), candidate("006208", { historyDays: 7300 })],
      AS_OF,
    );
    expect(result.core.primary?.symbol).toBe("006208");
    expect(result.core.alternate?.symbol).toBe("0050");
  });

  it("breaks equal history by higher median turnover, then by symbol", () => {
    const byTurnover = selectInstruments(
      [
        candidate("0050", { historyDays: 5000, recentTurnovers: [200_000_000] }),
        candidate("006208", { historyDays: 5000, recentTurnovers: [900_000_000] }),
      ],
      AS_OF,
    );
    expect(byTurnover.core.primary?.symbol).toBe("006208");
    expect(byTurnover.core.alternate?.symbol).toBe("0050");

    const bySymbol = selectInstruments(
      [candidate("006208", { historyDays: 5000 }), candidate("0050", { historyDays: 5000 })],
      AS_OF,
    );
    expect(bySymbol.core.primary?.symbol).toBe("0050");
    expect(bySymbol.core.alternate?.symbol).toBe("006208");
  });

  it("leaves primary null and lists reasons when no member is eligible", () => {
    const result = selectInstruments(
      [
        candidate("00679B", { historyDays: 100 }),
        candidate("00687B", { staleDays: 40, recentTurnovers: [5] }),
      ],
      AS_OF,
    );
    expect(result.bond.primary).toBeNull();
    expect(result.bond.alternate).toBeNull();
    expect(result.bond.rejected).toEqual([
      { symbol: "00679B", reasons: ["short_history"] },
      { symbol: "00687B", reasons: ["stale", "low_turnover"] },
    ]);
  });

  it("returns an empty selection for a category with no candidates and ignores unknown symbols", () => {
    const result = selectInstruments([candidate("00999")], AS_OF);
    for (const category of ["core", "bond", "dividend"] as const) {
      expect(result[category]).toEqual({
        category,
        primary: null,
        alternate: null,
        rejected: [],
      });
    }
  });

  it("applies the bond 3-year and stock 5-year thresholds per category", () => {
    const result = selectInstruments(
      [
        candidate("00679B", { historyDays: 1500 }),
        candidate("0056", { historyDays: 1500 }),
        candidate("0050", { historyDays: 1500 }),
      ],
      AS_OF,
    );
    expect(result.bond.primary?.symbol).toBe("00679B");
    expect(result.dividend.rejected).toEqual([{ symbol: "0056", reasons: ["short_history"] }]);
    expect(result.core.rejected).toEqual([{ symbol: "0050", reasons: ["short_history"] }]);
  });

  it("reproduces the 2026-10-14 result: 0051 is rejected for low turnover", () => {
    const result = selectInstruments(
      [
        candidate("0050", { historyDays: 8000, recentTurnovers: [9.8e9] }, "元大台灣50"),
        candidate("006208", { historyDays: 4000, recentTurnovers: [8.5e8] }, "富邦台50"),
        candidate("0051", { historyDays: 6000, recentTurnovers: [1.05e7] }, "元大中型100"),
        candidate("00679B", { historyDays: 3000 }, "元大美債20年"),
        candidate("00687B", { historyDays: 2900 }, "國泰20年美債"),
        candidate("0056", { historyDays: 6800 }, "元大高股息"),
        candidate("00713", { historyDays: 2500 }, "元大台灣高息低波"),
      ],
      AS_OF,
    );
    expect(result.core.primary?.symbol).toBe("0050");
    expect(result.core.alternate?.symbol).toBe("006208");
    expect(result.core.rejected).toEqual([{ symbol: "0051", reasons: ["low_turnover"] }]);
    expect(result.bond.primary?.symbol).toBe("00679B");
    expect(result.bond.alternate?.symbol).toBe("00687B");
    expect(result.dividend.primary?.symbol).toBe("0056");
    expect(result.dividend.alternate?.symbol).toBe("00713");
  });
});

describe("discoverCandidates", () => {
  const row = (symbol: string, name: string): EtfUniverseRow => ({
    symbol,
    name,
    market: "twse",
    industry: "ETF",
    updatedAt: new Date("2026-10-14T00:00:00Z"),
    historyCheckedAt: null,
  });

  it("hints a new bond ETF by 債 in the name or a trailing B in the symbol", () => {
    expect(discoverCandidates([row("00890B", "某某投資級公司債")])).toEqual([
      { symbol: "00890B", name: "某某投資級公司債", hint: "bond" },
    ]);
    expect(discoverCandidates([row("00891B", "某某特別ETF")])[0]?.hint).toBe("bond");
  });

  it("hints dividend and core by name", () => {
    const found = discoverCandidates([
      row("00930", "某某優息成長"),
      row("00931", "某某台灣領袖50"),
      row("00932", "某某收益ETF"),
    ]);
    expect(found.map((f) => f.hint)).toEqual(["dividend", "core", "dividend"]);
  });

  it("skips existing members and excluded names", () => {
    const found = discoverCandidates([
      row("0050", "元大台灣50"),
      row("00679B", "元大美債20年"),
      row("00631L", "元大台灣50正2"),
      row("00632R", "元大台灣50反1"),
      row("00635U", "期元大S&P黃金"),
      row("00933B", "某某公司債"),
    ]);
    expect(found.map((f) => f.symbol)).toEqual(["00933B"]);
  });

  it("gives a null hint to an unclassifiable name", () => {
    expect(discoverCandidates([row("00940X", "某某科技創新")])).toEqual([
      { symbol: "00940X", name: "某某科技創新", hint: null },
    ]);
  });
});
