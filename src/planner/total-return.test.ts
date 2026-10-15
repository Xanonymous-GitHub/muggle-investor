import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CorporateAction, PriceBar } from "@/sources/finmind";
import { buildTotalReturnIndex } from "./total-return";

/** Trimmed real FinMind TaiwanStockPrice rows for 0050. */
const realBars = (name: string): PriceBar[] =>
  (
    JSON.parse(readFileSync(`test/fixtures/finmind/${name}`, "utf8")) as {
      data: { date: string; close: number }[];
    }
  ).data.map((row) => bar(row.date, row.close));

const bar = (date: string, close: number): PriceBar => ({
  symbol: "0050",
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
  turnover: null,
});

const action = (
  exDate: string,
  beforePrice: number,
  afterPrice: number,
  kind: CorporateAction["kind"] = "dividend",
): CorporateAction => ({
  symbol: "0050",
  exDate,
  kind,
  beforePrice,
  afterPrice,
  cashDividend: kind === "dividend" ? beforePrice - afterPrice : null,
});

const indexOn = (points: { date: string; index: number }[], date: string) => {
  const point = points.find((p) => p.date === date);
  if (!point) throw new Error(`no point on ${date}`);
  return point.index;
};

describe("buildTotalReturnIndex", () => {
  it("returns [] for no bars", () => {
    expect(buildTotalReturnIndex([], [action("2025-01-02", 100, 99)])).toEqual([]);
  });

  it("follows close_t / close_0 without actions, starting at 1", () => {
    const bars = [bar("2025-01-02", 50), bar("2025-01-03", 55), bar("2025-01-06", 40)];
    const points = buildTotalReturnIndex(bars, []);
    expect(points.map((p) => p.date)).toEqual(["2025-01-02", "2025-01-03", "2025-01-06"]);
    expect(points[0]?.index).toBe(1);
    expect(points[1]?.index).toBeCloseTo(55 / 50, 12);
    expect(points[2]?.index).toBeCloseTo(40 / 50, 12);
  });

  it("treats a drop of exactly the cash dividend as a flat day", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-18", 100), bar("2025-07-21", 99)],
      [action("2025-07-21", 100, 99)],
    );
    // 99 × (100/99) / 100 = 1.0
    expect(points[1]?.index).toBeCloseTo(1.0, 12);
  });

  it("adds the reinvested dividend to the day's move", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-18", 100), bar("2025-07-21", 100.98)],
      [action("2025-07-21", 100, 99)],
    );
    expect(points[1]?.index).toBeCloseTo(1.0098 * (100 / 99), 12);
  });

  it("keeps the real 0050 split (2025-06-18, 188.65 → 47.16) continuous", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-06-17", 188.65), bar("2025-06-18", 47.5)],
      [action("2025-06-18", 188.65, 47.16, "split")],
    );
    // 47.5 × (188.65 / 47.16) / 188.65 = 47.5 / 47.16
    expect(points[1]?.index).toBeCloseTo(47.5 / 47.16, 12);
  });

  it("applies an action dated on a non-trading day at the next bar, once", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-18", 100), bar("2025-07-21", 99), bar("2025-07-22", 99)],
      [action("2025-07-19", 100, 99)],
    );
    expect(points[1]?.index).toBeCloseTo(1.0, 12);
    expect(points[2]?.index).toBeCloseTo(1.0, 12);
  });

  it("multiplies two actions on the same bar", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-18", 100), bar("2025-07-21", 24)],
      [action("2025-07-21", 100, 98), action("2025-07-19", 98, 24.5, "split")],
    );
    // Share ratio (100/98) × (98/24.5) = 100/24.5; factor 24 × (100/24.5) / 100 = 24/24.5 = 48/49.
    expect(points[1]?.index).toBeCloseTo(0.9795918367346939, 12);
  });

  it("ignores an action before the first bar", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-18", 100), bar("2025-07-21", 110)],
      [action("2025-07-17", 100, 50, "split"), action("2025-07-18", 100, 50, "split")],
    );
    // Both dated on or before the first bar: the first bar already reflects them.
    expect(points[1]?.index).toBeCloseTo(1.1, 12);
  });

  it("skips actions with non-positive prices", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-18", 100), bar("2025-07-21", 110)],
      [
        action("2025-07-21", 100, 0),
        action("2025-07-21", -1, 99),
        action("2025-07-21", 0, 99),
        action("2025-07-21", Number.POSITIVE_INFINITY, 99),
        action("2025-07-21", 100, Number.NaN),
      ],
    );
    expect(points[1]?.index).toBeCloseTo(1.1, 12);
  });

  it("gives the same result for unsorted input", () => {
    const bars = [bar("2025-07-18", 100), bar("2025-07-21", 99.5), bar("2025-07-22", 101)];
    const actions = [action("2025-07-21", 100, 99), action("2025-07-22", 99.5, 99.4)];
    const sorted = buildTotalReturnIndex(bars, actions);
    const shuffled = buildTotalReturnIndex(
      [bars[2], bars[0], bars[1]] as PriceBar[],
      [actions[1], actions[0]] as CorporateAction[],
    );
    expect(shuffled).toEqual(sorted);
    expect(shuffled.map((p) => p.date)).toEqual(["2025-07-18", "2025-07-21", "2025-07-22"]);
  });

  it("does not mutate its inputs", () => {
    const bars = [bar("2025-07-21", 99), bar("2025-07-18", 100)];
    const actions = [action("2025-07-21", 100, 99)];
    buildTotalReturnIndex(bars, actions);
    expect(bars.map((b) => b.date)).toEqual(["2025-07-21", "2025-07-18"]);
  });

  it("matches a share-count recomputation over three years with two dividends", () => {
    // Spreadsheet-style: hold shares, take each cash dividend on the ex-date and
    // buy more shares at the ex-date reference price; wealth / initial wealth is the index.
    const bars = [
      bar("2023-01-03", 100),
      bar("2023-07-03", 104),
      bar("2023-07-04", 103.5), // ex-date of a 2.0 dividend (before 104, after 102)
      bar("2024-01-02", 110),
      bar("2024-07-01", 96),
      bar("2024-07-02", 95.2), // ex-date of a 1.5 dividend (before 96, after 94.5)
      bar("2025-01-02", 118),
      bar("2025-12-31", 121.3),
    ];
    const actions = [action("2023-07-04", 104, 102), action("2024-07-02", 96, 94.5)];
    const dividendOn = new Map([
      ["2023-07-04", { cash: 2.0, ref: 102 }],
      ["2024-07-02", { cash: 1.5, ref: 94.5 }],
    ]);

    let shares = 1;
    const expected: number[] = [];
    for (const b of bars) {
      const dividend = dividendOn.get(b.date);
      if (dividend) shares += (shares * dividend.cash) / dividend.ref;
      expected.push((shares * b.close) / 100);
    }

    const points = buildTotalReturnIndex(bars, actions);
    points.forEach((p, i) => {
      expect(p.index).toBeCloseTo(expected[i] as number, 12);
    });
    // Hand check: 1.213 × (104/102) × (96/94.5)
    expect(points.at(-1)?.index).toBeCloseTo(1.213 * (104 / 102) * (96 / 94.5), 12);
  });

  it("stays continuous across the real 0050 split (trading halted 2025-06-11..17)", () => {
    const bars = realBars("price-0050-split-2025-06.json");
    const points = buildTotalReturnIndex(bars, [action("2025-06-18", 188.65, 47.16, "split")]);
    for (let i = 1; i < points.length; i++) {
      const factor = (points[i]?.index as number) / (points[i - 1]?.index as number);
      expect(Math.abs(factor - 1)).toBeLessThan(0.05);
    }
    // Previous bar is 2025-06-10 (close 188.65); ex-date close 47.57.
    expect(indexOn(points, "2025-06-18") / indexOn(points, "2025-06-10")).toBeCloseTo(
      47.57 / 47.16,
      12,
    );
  });

  it("adds the real 0050 cash dividend (2026-07-21, 99.2 → 98.6) to the day's move", () => {
    const bars = realBars("price-0050-dividend-2026-07.json");
    const points = buildTotalReturnIndex(bars, [action("2026-07-21", 99.2, 98.6)]);
    const priceMove = 102.5 / 99.2;
    const factor = indexOn(points, "2026-07-21") / indexOn(points, "2026-07-20");
    expect(factor).toBeCloseTo(priceMove * (99.2 / 98.6), 12);
    expect(factor / priceMove - 1).toBeCloseTo(0.6 / 98.6, 12);
    expect(indexOn(points, "2026-07-24")).toBeCloseTo((101.7 / 106.3) * (99.2 / 98.6), 12);
  });

  it("returns index 1 for a single bar", () => {
    expect(buildTotalReturnIndex([bar("2025-07-18", 100)], [])).toEqual([
      { date: "2025-07-18", index: 1 },
    ]);
  });

  it("ignores an action dated after the last bar", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-18", 100), bar("2025-07-21", 110)],
      [action("2025-07-22", 110, 55, "split")],
    );
    expect(points.map((p) => p.index)).toEqual([1, 1.1]);
  });

  it("drops a zero-close bar in the middle and keeps the index finite", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-17", 100), bar("2025-07-18", 0), bar("2025-07-21", 105)],
      [],
    );
    expect(points.map((p) => p.date)).toEqual(["2025-07-17", "2025-07-21"]);
    expect(points[1]?.index).toBeCloseTo(1.05, 12);
  });

  it.each([
    ["NaN", Number.NaN],
    ["negative", -5],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("drops a bar whose close is %s", (_label, close) => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-17", 100), bar("2025-07-18", close), bar("2025-07-21", 90)],
      [],
    );
    expect(points.map((p) => p.date)).toEqual(["2025-07-17", "2025-07-21"]);
    expect(points[1]?.index).toBeCloseTo(0.9, 12);
  });

  it("drops an invalid first bar and starts at the next valid one", () => {
    const points = buildTotalReturnIndex([bar("2025-07-17", 0), bar("2025-07-18", 100)], []);
    expect(points).toEqual([{ date: "2025-07-18", index: 1 }]);
  });

  it("rolls an action on a zero-close ex-date bar forward to the next valid bar", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-18", 100), bar("2025-07-21", 0), bar("2025-07-22", 99)],
      [action("2025-07-21", 100, 99)],
    );
    expect(points.map((p) => p.date)).toEqual(["2025-07-18", "2025-07-22"]);
    // 99 × (100/99) / 100 = 1
    expect(points[1]?.index).toBeCloseTo(1, 12);
  });

  it("returns [] when every bar is invalid", () => {
    expect(
      buildTotalReturnIndex([bar("2025-07-18", 0), bar("2025-07-21", Number.NaN)], []),
    ).toEqual([]);
  });

  it("drops invalid bars before deduping, so a later invalid duplicate keeps the valid bar", () => {
    const points = buildTotalReturnIndex(
      [bar("2025-07-18", 100), bar("2025-07-21", 120), bar("2025-07-18", 0)],
      [],
    );
    expect(points).toEqual([
      { date: "2025-07-18", index: 1 },
      { date: "2025-07-21", index: 1.2 },
    ]);
  });

  it("dedupes bars by date, last occurrence wins", () => {
    const points = buildTotalReturnIndex(
      [
        bar("2025-07-18", 100),
        bar("2025-07-21", 50),
        bar("2025-07-18", 80),
        bar("2025-07-21", 120),
      ],
      [],
    );
    expect(points).toEqual([
      { date: "2025-07-18", index: 1 },
      { date: "2025-07-21", index: 1.5 },
    ]);
  });
});
