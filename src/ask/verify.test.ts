import { describe, expect, it } from "vitest";
import { collectNumbers, extractNumbers, findUnsupportedNumbers } from "./verify";

describe("extractNumbers", () => {
  it("keeps percent signs and units out of the value", () => {
    expect(extractNumbers("漲了 5.5%，成交 1,234.5 萬")).toEqual([5.5, 12_345_000]);
    expect(extractNumbers("-3.2%")).toEqual([-3.2]);
  });

  it("handles thousands separators, units and full-width digits", () => {
    expect(extractNumbers("1,500,000")).toEqual([1_500_000]);
    expect(extractNumbers("150萬 與 150 萬 與 1.5億")).toEqual([1_500_000, 1_500_000, 150_000_000]);
    expect(extractNumbers("150w 1.5M 1.5m")).toEqual([1_500_000, 1_500_000, 1_500_000]);
    expect(extractNumbers("１，２３４．５")).toEqual([1234.5]);
    expect(extractNumbers("５．５％")).toEqual([5.5]);
  });

  it("does not read dates and times as numbers", () => {
    expect(extractNumbers("2026-10-14 收盤 105.5")).toEqual([105.5]);
    expect(extractNumbers("10/14 收盤 105.5")).toEqual([105.5]);
    expect(extractNumbers("10月14日 09:30 收盤 105.5")).toEqual([105.5]);
    expect(extractNumbers("2026/10/14")).toEqual([]);
  });

  it("returns an empty list for text without numbers", () => {
    expect(extractNumbers("沒有數字")).toEqual([]);
  });
});

describe("findUnsupportedNumbers", () => {
  const grounded = [100, 105.5];

  it("does not flag a figure derivable from two grounded numbers", () => {
    expect(findUnsupportedNumbers("上漲了 5.5%", grounded)).toEqual([]);
    expect(findUnsupportedNumbers("兩者相加 205.5", grounded)).toEqual([]);
    expect(findUnsupportedNumbers("差距 5.5", grounded)).toEqual([]);
  });

  it("derives a plain figure only by sum or difference (R-A4)", () => {
    expect(findUnsupportedNumbers("比值約 1.055", grounded)).toEqual(["1.055"]);
    expect(findUnsupportedNumbers("兩者相加 205.5", grounded)).toEqual([]);
  });

  it("derives a percentage only by percent change or ratio (R-A4)", () => {
    expect(findUnsupportedNumbers("占 94.8%", grounded)).toEqual([]);
    expect(findUnsupportedNumbers("上漲 4.6%", [612, 640])).toEqual([]);
    expect(findUnsupportedNumbers("相加 205.5%", grounded)).toEqual(["205.5%"]);
    expect(findUnsupportedNumbers("差距 5.5%", [10.5, 5])).toEqual(["5.5%"]);
  });

  it("accepts a grounded number as is", () => {
    expect(findUnsupportedNumbers("漲到 105.5", grounded)).toEqual([]);
    expect(findUnsupportedNumbers("1,234.5", [1234.5])).toEqual([]);
  });

  it("flags a number that is neither grounded nor derivable", () => {
    expect(findUnsupportedNumbers("漲了 20%", grounded)).toEqual(["20%"]);
    expect(findUnsupportedNumbers("目標價 888", grounded)).toEqual(["888"]);
  });

  it("matches signed percentages and direction-free wording", () => {
    expect(findUnsupportedNumbers("-3.2%", [-3.2])).toEqual([]);
    expect(findUnsupportedNumbers("下跌 3.2%", [-3.2])).toEqual([]);
  });

  it("matches units against grounded raw values", () => {
    expect(findUnsupportedNumbers("市值 1.5億", [150_000_000])).toEqual([]);
    expect(findUnsupportedNumbers("市值 150萬", [1_500_000])).toEqual([]);
  });

  it("respects the relative tolerance and the shown precision", () => {
    expect(findUnsupportedNumbers("收 105.5", [105.52])).toEqual([]);
    expect(findUnsupportedNumbers("收 1,235", [1234.5])).toEqual([]);
    expect(findUnsupportedNumbers("收 1000", [1004])).toEqual([]);
    expect(findUnsupportedNumbers("收 1000", [1006])).toEqual(["1000"]);
    expect(findUnsupportedNumbers("收 1000", [1006], { relTolerance: 0.01 })).toEqual([]);
    expect(findUnsupportedNumbers("收 1000", [1004], { relTolerance: 0 })).toEqual(["1000"]);
  });

  it("ignores small counts, ordinals, years and dates", () => {
    expect(findUnsupportedNumbers("3 個情境", [])).toEqual([]);
    expect(findUnsupportedNumbers("第 2 個", [])).toEqual([]);
    expect(findUnsupportedNumbers("第 12 名", [])).toEqual([]);
    expect(findUnsupportedNumbers("2026 年", [])).toEqual([]);
    expect(findUnsupportedNumbers("1990 與 2100 年", [])).toEqual([]);
    expect(findUnsupportedNumbers("2026-10-14 與 10/14", [])).toEqual([]);
  });

  it("still checks a small percentage or decimal", () => {
    expect(findUnsupportedNumbers("漲了 5%", [])).toEqual(["5%"]);
    expect(findUnsupportedNumbers("本益比 8.5", [])).toEqual(["8.5"]);
    expect(findUnsupportedNumbers("指數 22500 點、收 888 元", [])).toEqual(["22500", "888"]);
  });

  it("does not flag ordinary zh dates, years and counts", () => {
    for (const text of [
      "2026 年 10 月 14 日",
      "10 月",
      "民國 115 年",
      "115年第3季",
      "10/14/2026",
      "共 12 檔",
      "60 日均線",
      "前 10 大",
      "過去 20 個交易日",
      "MA20",
      "2026Q3",
      "1000 股",
    ]) {
      expect(findUnsupportedNumbers(text, []), text).toEqual([]);
    }
  });

  it("parses a leading-dot percentage as 0.5", () => {
    expect(extractNumbers(".5%")).toEqual([0.5]);
    expect(findUnsupportedNumbers("漲 .5%", [0.5])).toEqual([]);
    expect(findUnsupportedNumbers("漲 .5%", [])).toEqual([".5%"]);
  });

  it("reports a repeated mention once, in order, with the original text", () => {
    expect(findUnsupportedNumbers("先 888，再 20%，又 888，又 20%", grounded)).toEqual([
      "888",
      "20%",
    ]);
    expect(findUnsupportedNumbers("市值 １５０萬", [])).toEqual(["１５０萬"]);
  });
});

describe("collectNumbers", () => {
  it("walks nested values and returns every finite number", () => {
    expect(
      collectNumbers({
        a: 1,
        b: [2.5, { c: -3 }],
        d: "x",
        e: null,
        f: true,
        g: Number.NaN,
        h: Number.POSITIVE_INFINITY,
      }),
    ).toEqual([1, 2.5, -3]);
  });

  it("parses numeric strings, including ones embedded in text", () => {
    expect(collectNumbers({ close: "1,234.5", pct: "5.5%", note: "營收 7,000 億" })).toEqual([
      1234.5, 5.5, 700_000_000_000,
    ]);
  });

  it("handles a bare scalar and empty containers", () => {
    expect(collectNumbers(42)).toEqual([42]);
    expect(collectNumbers([])).toEqual([]);
    expect(collectNumbers(undefined)).toEqual([]);
  });
});

// Seeded generator so the flag-rate checks are reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const logUniform = (r: () => number, lo: number, hi: number) => lo * (hi / lo) ** r();

/** A tool-result-like grounded set: prices, volumes, small percent moves, market caps. */
function realisticGrounded(n: number, r: () => number): number[] {
  return Array.from({ length: n }, (_, i) => {
    switch (i % 4) {
      case 0:
        return Number(logUniform(r, 5, 2000).toFixed(2));
      case 1:
        return Math.round(logUniform(r, 1e3, 1e8));
      case 2:
        return Number(((r() - 0.5) * 20).toFixed(1));
      default:
        return Math.round(logUniform(r, 1e9, 1e13));
    }
  });
}

/** Figures a model might invent: integer and one-decimal percentages, prices, large amounts. */
function inventedFigures(count: number, r: () => number): string[] {
  return Array.from({ length: count }, (_, i) => {
    switch (i % 4) {
      case 0:
        return `${Math.round(11 + r() * 70)}%`;
      case 1:
        return `${(11 + r() * 70).toFixed(1)}%`;
      case 2:
        return (5 + r() * 1995).toFixed(2);
      default:
        return Math.round(logUniform(r, 1e4, 1e9)).toLocaleString("en-US");
    }
  });
}

describe("findUnsupportedNumbers flag rate (R-A4)", () => {
  // Pairwise derivation is dense: the more grounded values, the more figures some pair explains.
  // These floors pin today's behaviour (seeded, deterministic); grounding per record (pairs from
  // one tool result) is the real fix for large sets.
  it.each([
    [20, 0.85],
    [50, 0.6],
    [150, 0.35],
  ])("flags invented figures against %i realistic grounded values (rate >= %d)", (n, minRate) => {
    const r = mulberry32(2026 + n);
    const grounded = realisticGrounded(n, r);
    const invented = inventedFigures(200, r);
    const flagged = invented.filter(
      (fig) => findUnsupportedNumbers(`目標 ${fig}`, grounded).length > 0,
    ).length;
    expect(flagged / invented.length).toBeGreaterThanOrEqual(minRate);
  });

  it("flags at least 90% of decimal figures (prices, one-decimal percentages) with 20 grounded values", () => {
    const r = mulberry32(99);
    const grounded = realisticGrounded(20, r);
    const decimals = inventedFigures(400, r).filter((fig) => fig.includes("."));
    const flagged = decimals.filter(
      (fig) => findUnsupportedNumbers(`目標 ${fig}`, grounded).length > 0,
    ).length;
    expect(flagged / decimals.length).toBeGreaterThanOrEqual(0.9);
  });

  it.each([20, 50, 150])(
    "still passes a true percent change and a true sum with %i grounded values",
    (n) => {
      const r = mulberry32(7 + n);
      const grounded = [...realisticGrounded(n - 4, r), 612, 640, 300, 477];
      expect(findUnsupportedNumbers("上漲 4.6%", grounded)).toEqual([]);
      expect(findUnsupportedNumbers("合計 777", grounded)).toEqual([]);
    },
  );
});

describe("number parsing stays linear", () => {
  it("handles 100 KB probes quickly", () => {
    const size = 100_000;
    const probes = [
      "1234567890".repeat(size / 10),
      "1,234,".repeat(size / 6),
      "1 ".repeat(size / 2),
      "1億".repeat(size / 2),
      "漲了 12.5% ".repeat(size / 10),
    ];
    const t0 = performance.now();
    for (const probe of probes) {
      extractNumbers(probe);
      findUnsupportedNumbers(probe, [100, 105.5]);
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
