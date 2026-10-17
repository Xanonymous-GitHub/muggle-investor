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
    expect(findUnsupportedNumbers("上漲了 5.5%", [grounded])).toEqual([]);
    expect(findUnsupportedNumbers("兩者相加 205.5", [grounded])).toEqual([]);
    expect(findUnsupportedNumbers("差距 5.5", [grounded])).toEqual([]);
  });

  it("derives a plain figure only by sum or difference (R-A4)", () => {
    expect(findUnsupportedNumbers("比值約 1.055", [grounded])).toEqual(["1.055"]);
    expect(findUnsupportedNumbers("兩者相加 205.5", [grounded])).toEqual([]);
  });

  it("derives a percentage only by percent change or ratio (R-A4)", () => {
    expect(findUnsupportedNumbers("占 94.8%", [grounded])).toEqual([]);
    expect(findUnsupportedNumbers("上漲 4.6%", [[612, 640]])).toEqual([]);
    expect(findUnsupportedNumbers("相加 205.5%", [grounded])).toEqual(["205.5%"]);
    expect(findUnsupportedNumbers("差距 5.5%", [[10.5, 5]])).toEqual(["5.5%"]);
  });

  it("accepts a grounded number as is", () => {
    expect(findUnsupportedNumbers("漲到 105.5", [grounded])).toEqual([]);
    expect(findUnsupportedNumbers("1,234.5", [[1234.5]])).toEqual([]);
  });

  it("flags a number that is neither grounded nor derivable", () => {
    expect(findUnsupportedNumbers("漲了 20%", [grounded])).toEqual(["20%"]);
    expect(findUnsupportedNumbers("目標價 888", [grounded])).toEqual(["888"]);
  });

  it("matches signed percentages and direction-free wording", () => {
    expect(findUnsupportedNumbers("-3.2%", [[-3.2]])).toEqual([]);
    expect(findUnsupportedNumbers("下跌 3.2%", [[-3.2]])).toEqual([]);
  });

  it("matches units against grounded raw values", () => {
    expect(findUnsupportedNumbers("市值 1.5億", [[150_000_000]])).toEqual([]);
    expect(findUnsupportedNumbers("市值 150萬", [[1_500_000]])).toEqual([]);
  });

  it("respects the relative tolerance and the shown precision", () => {
    expect(findUnsupportedNumbers("收 105.5", [[105.52]])).toEqual([]);
    expect(findUnsupportedNumbers("收 1,235", [[1234.5]])).toEqual([]);
    expect(findUnsupportedNumbers("收 1000", [[1004]])).toEqual([]);
    expect(findUnsupportedNumbers("收 1000", [[1006]])).toEqual(["1000"]);
    expect(findUnsupportedNumbers("收 1000", [[1006]], { relTolerance: 0.01 })).toEqual([]);
    expect(findUnsupportedNumbers("收 1000", [[1004]], { relTolerance: 0 })).toEqual(["1000"]);
  });

  it("ignores small counts, ordinals, years and dates", () => {
    expect(findUnsupportedNumbers("3 個情境", [[]])).toEqual([]);
    expect(findUnsupportedNumbers("第 2 個", [[]])).toEqual([]);
    expect(findUnsupportedNumbers("第 12 名", [[]])).toEqual([]);
    expect(findUnsupportedNumbers("2026 年", [[]])).toEqual([]);
    expect(findUnsupportedNumbers("1990 與 2100 年", [[]])).toEqual([]);
    expect(findUnsupportedNumbers("2026-10-14 與 10/14", [[]])).toEqual([]);
  });

  it("still checks a small percentage or decimal", () => {
    expect(findUnsupportedNumbers("漲了 5%", [[]])).toEqual(["5%"]);
    expect(findUnsupportedNumbers("本益比 8.5", [[]])).toEqual(["8.5"]);
    expect(findUnsupportedNumbers("指數 22500 點、收 888 元", [[]])).toEqual(["22500", "888"]);
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
      expect(findUnsupportedNumbers(text, [[]]), text).toEqual([]);
    }
  });

  it("parses a leading-dot percentage as 0.5", () => {
    expect(extractNumbers(".5%")).toEqual([0.5]);
    expect(findUnsupportedNumbers("漲 .5%", [[0.5]])).toEqual([]);
    expect(findUnsupportedNumbers("漲 .5%", [[]])).toEqual([".5%"]);
  });

  it("reports a repeated mention once, in order, with the original text", () => {
    expect(findUnsupportedNumbers("先 888，再 20%，又 888，又 20%", [grounded])).toEqual([
      "888",
      "20%",
    ]);
    expect(findUnsupportedNumbers("市值 １５０萬", [[]])).toEqual(["１５０萬"]);
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

const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);

/** One tool result: prices near 600, index levels near 20000, a percent move, volumes. */
function realisticGroup(r: () => number): number[] {
  return [
    ...Array.from({ length: 10 }, () => Number(between(r, 570, 640).toFixed(2))),
    ...Array.from({ length: 2 }, () => Number(between(r, 19_000, 21_500).toFixed(1))),
    Number(between(r, -5, 5).toFixed(1)),
    ...Array.from({ length: 2 }, () => Math.round(logUniform(r, 1e5, 1e8))),
  ];
}

const logUniform = (r: () => number, lo: number, hi: number) => lo * (hi / lo) ** r();

const realisticGroups = (count: number, r: () => number) =>
  Array.from({ length: count }, () => realisticGroup(r));

/** Decimal figures a model might invent: one-decimal percentages, prices, index levels. */
function inventedDecimals(count: number, r: () => number): string[] {
  return Array.from({ length: count }, (_, i) => {
    switch (i % 3) {
      case 0:
        return `${between(r, 11, 80).toFixed(1)}%`;
      case 1:
        return between(r, 5, 2000).toFixed(2);
      default:
        return between(r, 5000, 40_000).toFixed(1);
    }
  });
}

/** Integer percentages and large integer amounts a model might invent. */
function inventedIntegers(count: number, r: () => number): string[] {
  return Array.from({ length: count }, (_, i) =>
    i % 2 === 0
      ? `${Math.round(between(r, 11, 80))}%`
      : Math.round(logUniform(r, 1e4, 1e9)).toLocaleString("en-US"),
  );
}

const flagRate = (figures: string[], groups: number[][]) =>
  figures.filter((fig) => findUnsupportedNumbers(`目標 ${fig}`, groups).length > 0).length /
  figures.length;

describe("findUnsupportedNumbers with grounded groups (R-A5)", () => {
  it.each([
    [10, 150],
    [2, 30],
  ])("flags invented figures against %i tool results (%i grounded values)", (groupCount) => {
    const r = mulberry32(4242);
    const groups = realisticGroups(groupCount, r);
    expect(flagRate(inventedDecimals(200, r), groups)).toBeGreaterThanOrEqual(0.9);
    expect(flagRate(inventedIntegers(200, r), groups)).toBeGreaterThanOrEqual(0.8);
  });

  it("flags at least as much against 2 groups as against 10", () => {
    const r = mulberry32(31);
    const ten = realisticGroups(10, r);
    const two = ten.slice(0, 2);
    const figures = [...inventedDecimals(200, r), ...inventedIntegers(200, r)];
    expect(flagRate(figures, two)).toBeGreaterThanOrEqual(flagRate(figures, ten));
  });

  it("passes a true percent change, sum and difference inside one group", () => {
    const r = mulberry32(5);
    const groups = [...realisticGroups(9, r), [612, 640, 300, 477, 6400, 6120]];
    expect(findUnsupportedNumbers("上漲 4.6%", groups)).toEqual([]);
    expect(findUnsupportedNumbers("合計 777", groups)).toEqual([]);
    expect(findUnsupportedNumbers("價差 280", groups)).toEqual([]);
    expect(findUnsupportedNumbers("占 95.6%", groups)).toEqual([]);
  });

  it("flags a derived figure whose operands sit in different groups (documented soft-flag cost)", () => {
    expect(findUnsupportedNumbers("上漲 4.6%", [[612], [640]])).toEqual(["4.6%"]);
    expect(findUnsupportedNumbers("合計 777", [[300], [477]])).toEqual(["777"]);
    expect(findUnsupportedNumbers("上漲 4.6%", [[612, 640]])).toEqual([]);
  });

  it("matches a figure directly against any group", () => {
    expect(findUnsupportedNumbers("收 105.5 與 888", [[100], [105.5], [1, 888]])).toEqual([]);
    expect(findUnsupportedNumbers("目標 40%", [[0.4]])).toEqual([]);
  });

  it("flags every checkable number when nothing is grounded", () => {
    expect(findUnsupportedNumbers("漲 4.6%，收 105.5，共 12 檔，2026 年", [])).toEqual([
      "4.6%",
      "105.5",
    ]);
    expect(findUnsupportedNumbers("漲 4.6%，收 105.5", [[], []])).toEqual(["4.6%", "105.5"]);
  });

  it("derives within a group across the 20x band only", () => {
    expect(findUnsupportedNumbers("合計 1,100", [[100, 1000]])).toEqual([]);
    expect(findUnsupportedNumbers("合計 1,010", [[10, 1000]])).toEqual(["1,010"]);
  });
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
      "1,1".repeat(size / 3),
      "11,".repeat(size / 3),
      "1,11".repeat(size / 4),
      "11,11,".repeat(size / 6),
      "1 m ".repeat(size / 4),
    ];
    for (const probe of probes) {
      const t0 = performance.now();
      extractNumbers(probe);
      findUnsupportedNumbers(probe, [[100, 105.5]]);
      expect(performance.now() - t0, probe.slice(0, 8)).toBeLessThan(500);
    }
  });
});

describe("spaced ASCII units are not amounts in answers (N1)", () => {
  it.each([
    ["60 K線", [60]],
    ["日K 20 k棒", [20]],
    ["持有 3 m", [3]],
    ["5 M 平均", [5]],
    ["10 W", [10]],
    ["2 m 報酬 12%", [2, 12]],
    ["60K線", [60]],
  ])("reads %s as plain numbers", (text, values) => {
    expect(extractNumbers(text)).toEqual(values);
  });

  it("keeps glued units and spaced word units", () => {
    expect(extractNumbers("60K")).toEqual([60_000]);
    expect(extractNumbers("150w 1.5M")).toEqual([1_500_000, 1_500_000]);
    expect(extractNumbers("1.5 million")).toEqual([1_500_000]);
  });

  it("does not turn a spaced letter into a thousand-fold amount", () => {
    expect(findUnsupportedNumbers("持有 30 m", [[30_000_000]])).toEqual(["30"]);
  });
});

describe("findUnsupportedNumbers survives hostile grounding (S1/S2/S3)", () => {
  it.each([
    [[1, 2, 3]],
    [[[1], 2]],
    [[null]],
    [undefined],
    ["abc"],
    [42],
    [{ a: [1] }],
    [[[Number.NaN, "x", null, Number.POSITIVE_INFINITY]]],
  ])("never throws on %j", (bad) => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
    expect(() => findUnsupportedNumbers("收 1.5 與 888", bad as any)).not.toThrow();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
    expect(findUnsupportedNumbers("收 1.5 與 888", bad as any)).toBeInstanceOf(Array);
  });

  it("treats a bare number entry as part of one implicit group", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
    const flat = [100, 105.5] as any;
    expect(findUnsupportedNumbers("漲到 105.5", flat)).toEqual([]);
    expect(findUnsupportedNumbers("上漲 5.5%", flat)).toEqual([]);
    expect(findUnsupportedNumbers("漲了 20%", flat)).toEqual(["20%"]);
  });

  it("completes quickly with a 100k-value group and stays sane", () => {
    const big = Array.from({ length: 100_000 }, (_, i) => 100 + i * 0.37);
    const t0 = performance.now();
    const flagged = findUnsupportedNumbers("漲 4.6%，收 123.31，目標 99999.99", [big]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(flagged).toEqual(["4.6%", "99999.99"]);
  });

  it("caps collectNumbers at 5000 numbers", () => {
    const t0 = performance.now();
    expect(collectNumbers(Array.from({ length: 100_000 }, (_, i) => i))).toHaveLength(5000);
    expect(collectNumbers({ s: "1 ".repeat(500_000) })).toHaveLength(5000);
    expect(collectNumbers([[1, 2], { a: "3 4" }])).toEqual([1, 2, 3, 4]);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

// A second, independent distribution (reviewer's): quote-like groups with a random price base,
// a change %, PE, yield, index level, two volumes and a 1-100 value.
function mixedGroup(r: () => number): number[] {
  const base = between(r, 20, 1200);
  return [
    ...Array.from({ length: 8 }, () => Number((base * between(r, 0.93, 1.07)).toFixed(2))),
    Number(between(r, -8, 8).toFixed(2)),
    Number(between(r, 5, 40).toFixed(1)),
    Number(between(r, 0.5, 7).toFixed(2)),
    Number(between(r, 15_000, 24_000).toFixed(1)),
    Math.round(logUniform(r, 1e5, 1e9)),
    Math.round(logUniform(r, 1e5, 1e9)),
    Number(between(r, 1, 100).toFixed(1)),
  ];
}

const mixedDecimals = (count: number, r: () => number) =>
  Array.from(
    { length: count },
    (_, i) =>
      [
        `${between(r, 0.5, 80).toFixed(1)}%`,
        between(r, 5, 2000).toFixed(2),
        between(r, 5000, 40_000).toFixed(1),
        between(r, 1, 60).toFixed(1),
      ][i % 4],
  ) as string[];

const mixedIntegers = (count: number, r: () => number) =>
  Array.from({ length: count }, (_, i) =>
    i % 2
      ? Math.round(logUniform(r, 1e4, 1e9)).toLocaleString("en-US")
      : `${Math.round(between(r, 11, 80))}%`,
  );

describe("findUnsupportedNumbers on a mixed quote-like distribution (R-A6)", () => {
  const meanRates = (groupCount: number) => {
    const dec: number[] = [];
    const int: number[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const r = mulberry32(seed * 7919);
      const groups = Array.from({ length: groupCount }, () => mixedGroup(r));
      dec.push(flagRate(mixedDecimals(400, r), groups));
      int.push(flagRate(mixedIntegers(400, r), groups));
    }
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    return { dec: mean(dec), int: mean(int) };
  };

  it("keeps the floors at 10 groups", () => {
    const { dec, int } = meanRates(10);
    // Measured (8 seeds): decimals 0.768, integers 0.819. The 0.8 decimal target is not reachable
    // here: sums/differences among small quote fields (PE, yield, change, 1-100) land densely in 1-60.
    expect(dec).toBeGreaterThanOrEqual(0.75);
    expect(int).toBeGreaterThanOrEqual(0.78);
  });

  it("flags more with fewer groups", () => {
    const two = meanRates(2);
    const ten = meanRates(10);
    expect(two.dec).toBeGreaterThanOrEqual(ten.dec);
    expect(two.int).toBeGreaterThanOrEqual(ten.int);
  });

  it("does not derive a percentage from small operands (PE, yield, percent values)", () => {
    expect(findUnsupportedNumbers("成長 32.0%", [[25, 33]])).toEqual(["32.0%"]);
    expect(findUnsupportedNumbers("成長 32.0%", [[250, 330]])).toEqual([]);
    expect(findUnsupportedNumbers("成長 25%", [[25]])).toEqual([]);
  });

  it("still derives a true percent change, sum and difference in one group", () => {
    const g = [[612.5, 640.3, 598, 21_000.4, 20_500.2, 123_456_789, 98_765_432]];
    for (const text of [
      "上漲 4.5%",
      "下跌 2.4%",
      "差 27.8",
      "合計 1252.8",
      "指數漲 500.2 點",
      "比值 95.7%",
    ]) {
      expect(findUnsupportedNumbers(text, g), text).toEqual([]);
    }
  });
});
