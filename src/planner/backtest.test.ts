import { describe, expect, it } from "vitest";
import { alignOnCommonDates, runBacktest, type Strategy, simulate } from "./backtest";
import type { Slice } from "./rules/allocation";
import type { TrPoint } from "./total-return";

const NO_WEIGHT: Record<Slice, number> = { core: 0, bond: 0, dividend: 0, satellite: 0, cash: 0 };
const weights = (w: Partial<Record<Slice, number>>) => ({ ...NO_WEIGHT, ...w });
const strategy = (s: Partial<Strategy>): Strategy => ({
  weights: weights({ core: 100 }),
  lump: 0,
  trancheMonths: 1,
  monthly: 0,
  rebalanceYearly: false,
  ...s,
});
const tr = (pairs: readonly [string, number][]): TrPoint[] =>
  pairs.map(([date, index]) => ({ date, index }));

describe("alignOnCommonDates", () => {
  it("keeps only dates present in every series", () => {
    const a = tr([
      ["2021-01-04", 1],
      ["2021-01-05", 2],
      ["2021-01-06", 3],
    ]);
    const b = tr([
      ["2021-01-04", 10],
      ["2021-01-06", 30],
      ["2021-01-07", 40],
    ]);
    expect(alignOnCommonDates([a, b])).toEqual({
      dates: ["2021-01-04", "2021-01-06"],
      indices: [
        [1, 3],
        [10, 30],
      ],
    });
  });

  it("is empty for no series", () => {
    expect(alignOnCommonDates([])).toEqual({ dates: [], indices: [] });
  });
});

describe("runBacktest", () => {
  it("returns money unchanged on a flat index", () => {
    const core = tr([
      ["2021-01-04", 1],
      ["2021-01-20", 1],
      ["2021-02-01", 1],
      ["2021-03-01", 1],
      ["2021-04-01", 1],
    ]);
    // 1000 over 2 tranches = 500 + 500, plus 100 a month for 4 months → 1400.
    const r = runBacktest({ core }, strategy({ lump: 1000, trancheMonths: 2, monthly: 100 }));
    expect(r).not.toBeNull();
    expect(r?.invested).toBe(1400);
    expect(r?.finalValue).toBe(1400);
    expect(r?.xirr).toBeCloseTo(0, 6);
    expect(r?.maxDrawdown).toBe(0);
    expect(r?.volatility).toBe(0);
    expect(r?.cagr).toBeNull(); // more than one contribution
    expect(r?.from).toBe("2021-01-04");
    expect(r?.to).toBe("2021-04-01");
  });

  it("doubles a single lump over two years", () => {
    const core = tr([
      ["2020-01-01", 1],
      ["2021-01-01", Math.SQRT2],
      ["2022-01-01", 2],
    ]);
    const r = runBacktest({ core }, strategy({ lump: 1000 }));
    expect(r?.invested).toBe(1000);
    expect(r?.finalValue).toBe(2000);
    // 2^(365/731) − 1 ≈ 0.41354 (731 days, actual/365), within 1e-3 of √2 − 1 ≈ 0.4142.
    expect(r?.cagr).toBeCloseTo(2 ** (365 / 731) - 1, 9);
    expect(Math.abs((r?.cagr ?? 0) - 0.4142)).toBeLessThan(1e-3);
    expect(r?.xirr).toBeCloseTo(2 ** (365 / 731) - 1, 6);
    expect(r?.maxDrawdown).toBe(0);
    // Two one-year windows, each ×√2.
    expect(r?.worstYear).toBeCloseTo(Math.SQRT2 - 1, 9);
  });

  it("buys units monthly on a linearly rising index", () => {
    // Index on the 1st of each month: 1 + k/11 for k = 0..11 (1 → 2).
    // Each 1000 buys 1000 / (1 + k/11) = 11000 / (11 + k) units, so
    // units = 11000 × (1/11 + 1/12 + … + 1/22) ≈ 11000 × 0.7618460 ≈ 8380.31,
    // final value = units × 2 ≈ 16760.61; invested = 12 × 1000.
    const core = tr(
      Array.from({ length: 12 }, (_, k) => [
        `2021-${String(k + 1).padStart(2, "0")}-01`,
        1 + k / 11,
      ]),
    );
    let units = 0;
    for (let j = 11; j <= 22; j++) units += 11000 / j;
    const r = runBacktest({ core }, strategy({ monthly: 1000 }));
    expect(r?.invested).toBe(12000);
    expect(r?.finalValue).toBeCloseTo(units * 2, 2);
    expect(r?.finalValue).toBeCloseTo(16760.61, 1);
    expect(r?.cagr).toBeNull();
    expect(r?.xirr).toBeGreaterThan(0);
  });

  it("stages a lump over six months on each month's first trading day", () => {
    // Two trading days a month, some months starting after the 1st (e.g. 2021-05-03).
    const days = [
      "2021-01-04",
      "2021-01-15",
      "2021-02-01",
      "2021-02-10",
      "2021-03-01",
      "2021-03-12",
      "2021-04-01",
      "2021-04-20",
      "2021-05-03",
      "2021-05-14",
      "2021-06-01",
      "2021-06-11",
      "2021-07-01",
      "2021-07-09",
    ];
    const core = tr(days.map((d) => [d, 1]));
    const r = runBacktest({ core }, strategy({ lump: 600000, trancheMonths: 6 }));
    const investedOn = (date: string) => r?.valueSeries.find((p) => p.date === date)?.invested;
    expect(investedOn("2021-01-04")).toBe(100000);
    expect(investedOn("2021-01-15")).toBe(100000);
    expect(investedOn("2021-02-01")).toBe(200000);
    expect(investedOn("2021-05-03")).toBe(500000);
    expect(investedOn("2021-06-01")).toBe(600000);
    expect(investedOn("2021-07-09")).toBe(600000);
    expect(r?.invested).toBe(600000);
  });

  it("puts the tranche remainder into the first month", () => {
    const core = tr([
      ["2021-01-04", 1],
      ["2021-02-01", 1],
      ["2021-03-01", 1],
    ]);
    // 100 / 3 → floor 33 each, remainder 1 into month 1: 34, 33, 33.
    const r = runBacktest({ core }, strategy({ lump: 100, trancheMonths: 3 }));
    expect(r?.valueSeries.map((p) => p.invested)).toEqual([34, 67, 100]);
  });

  it("keeps a cash slice at its contributed amount", () => {
    const core = tr([
      ["2021-01-04", 1],
      ["2021-06-01", 2],
    ]);
    // 1000 at 50/50: core 500 → 1000, cash stays 500 → 1500.
    const sim = simulate(
      { dates: ["2021-01-04", "2021-06-01"], prices: { core: [1, 2] } },
      strategy({ weights: weights({ core: 50, cash: 50 }), lump: 1000 }),
    );
    expect(sim.units.cash).toBe(500);
    expect(sim.units.core).toBe(500);
    const r = runBacktest(
      { core },
      strategy({ weights: weights({ core: 50, cash: 50 }), lump: 1000 }),
    );
    expect(r?.finalValue).toBe(1500);
  });

  it("prices satellite with the core series", () => {
    const core = tr([
      ["2021-01-04", 1],
      ["2021-03-01", 0.8],
      ["2021-06-01", 1.3],
    ]);
    const asCore = runBacktest({ core }, strategy({ lump: 1000, monthly: 50 }));
    const asSatellite = runBacktest(
      { core },
      strategy({ weights: weights({ satellite: 100 }), lump: 1000, monthly: 50 }),
    );
    expect(asSatellite).toEqual(asCore);
  });

  it("rebalances a 50/50 core/bond mix on the first trading day on or after the anniversary", () => {
    const dates = ["2020-01-02", "2020-07-01", "2021-01-04", "2021-01-05"];
    const coreIdx = [1, 1.5, 2, 4];
    const bondIdx = [1, 1, 1, 1];
    const s = strategy({
      weights: weights({ core: 50, bond: 50 }),
      lump: 1000,
      rebalanceYearly: true,
    });
    // Day 1: 500 → 500 core units, 500 → 500 bond units.
    // Anniversary 2021-01-02 is not a trading day → 2021-01-04: core 500 × 2 = 1000, bond 500,
    // total 1500 → 750 each → core 750 / 2 = 375 units, bond 750 / 1 = 750 units.
    const atAnniversary = simulate(
      {
        dates: dates.slice(0, 3),
        prices: { core: coreIdx.slice(0, 3), bond: bondIdx.slice(0, 3) },
      },
      s,
    );
    expect(atAnniversary.units.core).toBeCloseTo(375, 9);
    expect(atAnniversary.units.bond).toBeCloseTo(750, 9);
    // Next day core doubles: 375 × 4 + 750 = 2250 (without rebalancing: 500 × 4 + 500 = 2500).
    const core = tr(dates.map((d, i) => [d, coreIdx[i] as number]));
    const bond = tr(dates.map((d, i) => [d, bondIdx[i] as number]));
    expect(runBacktest({ core, bond }, s)?.finalValue).toBe(2250);
    expect(runBacktest({ core, bond }, { ...s, rebalanceYearly: false })?.finalValue).toBe(2500);
  });

  it("measures drawdown on unit value, not on money added", () => {
    // Index 1 → 0.5 → 0.5: the unit value halves even though a later 10000 lifts the balance.
    const core = tr([
      ["2021-01-04", 1],
      ["2021-01-20", 0.5],
      ["2021-02-01", 0.5],
    ]);
    const r = runBacktest({ core }, strategy({ lump: 100, monthly: 10000 }));
    expect(r?.maxDrawdown).toBeCloseTo(-0.5, 12);
    // 10100 → 5050 on day 2, then +10000 → 15050.
    expect(r?.finalValue).toBe(15050);
  });

  it("is null with fewer than 2 common dates or a missing series", () => {
    const core = tr([["2021-01-04", 1]]);
    expect(runBacktest({ core }, strategy({ lump: 1000 }))).toBeNull();
    const twoDays = tr([
      ["2021-01-04", 1],
      ["2021-01-05", 1],
    ]);
    expect(
      runBacktest(
        { core: twoDays },
        strategy({ weights: weights({ core: 50, bond: 50 }), lump: 1 }),
      ),
    ).toBeNull();
  });

  it("skips dates missing from any used series without producing NaN", () => {
    const core = tr([
      ["2021-01-04", 1],
      ["2021-01-05", 1.1],
      ["2021-01-06", 1.2],
      ["2021-02-01", 1.3],
    ]);
    const bond = tr([
      ["2021-01-04", 1],
      ["2021-01-06", 1.01],
      ["2021-02-01", 1.02],
    ]);
    const r = runBacktest(
      { core, bond },
      strategy({ weights: weights({ core: 60, bond: 40 }), lump: 1000, monthly: 100 }),
    );
    expect(r?.valueSeries.map((p) => p.date)).toEqual(["2021-01-04", "2021-01-06", "2021-02-01"]);
    for (const p of r?.valueSeries ?? []) {
      expect(Number.isFinite(p.value)).toBe(true);
      expect(Number.isFinite(p.invested)).toBe(true);
    }
    for (const n of [r?.finalValue, r?.xirr, r?.maxDrawdown, r?.volatility]) {
      expect(Number.isNaN(n)).toBe(false);
    }
  });

  it("rejects weights that do not sum to 100", () => {
    const core = tr([
      ["2021-01-04", 1],
      ["2021-01-05", 1],
    ]);
    expect(() => runBacktest({ core }, strategy({ weights: weights({ core: 90 }) }))).toThrow(
      RangeError,
    );
  });

  it("runs 6000 days × 3 slices with monthly contributions well under a second", () => {
    const start = Date.UTC(2003, 0, 1);
    const make = (phase: number): TrPoint[] =>
      Array.from({ length: 6000 }, (_, i) => ({
        date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
        index: 1 + i / 3000 + 0.1 * Math.sin(i / 50 + phase),
      }));
    const series = { core: make(0), bond: make(1), dividend: make(2) };
    const t0 = performance.now();
    const r = runBacktest(
      series,
      strategy({
        weights: weights({ core: 45, bond: 25, dividend: 20, satellite: 5, cash: 5 }),
        lump: 600000,
        trancheMonths: 6,
        monthly: 10000,
        rebalanceYearly: true,
      }),
    );
    const elapsed = performance.now() - t0;
    expect(r?.valueSeries).toHaveLength(6000);
    expect(elapsed).toBeLessThan(2000);
    for (const p of r?.valueSeries ?? []) expect(Number.isFinite(p.value)).toBe(true);
  });

  it("gives the same unit-value metrics with or without a large monthly amount", () => {
    // Monthly points over 14 months; the unit value depends only on the index path.
    const path = [1, 1.1, 0.9, 0.95, 1.2, 1.15, 0.8, 0.85, 1, 1.1, 1.05, 1.3, 1.25, 1.4];
    const core = tr(
      path.map((index, k) => [new Date(Date.UTC(2020, k, 1)).toISOString().slice(0, 10), index]),
    );
    const small = runBacktest({ core }, strategy({ lump: 100 }));
    const large = runBacktest({ core }, strategy({ lump: 100, monthly: 1_000_000 }));
    expect(small?.worstYear).not.toBeNull();
    expect(large?.maxDrawdown).toBeCloseTo(small?.maxDrawdown as number, 12);
    expect(large?.volatility).toBeCloseTo(small?.volatility as number, 12);
    expect(large?.worstYear).toBeCloseTo(small?.worstYear as number, 12);
    expect(large?.invested).toBe(100 + 14 * 1_000_000);
  });

  it("reports exact zeros on a flat index with fractional weights and rebalancing", () => {
    const flat = (n: number) =>
      tr(
        Array.from({ length: n }, (_, k) => [
          new Date(Date.UTC(2020, 0, 1 + 7 * k)).toISOString().slice(0, 10),
          1,
        ]),
      );
    const series = { core: flat(110), bond: flat(110), dividend: flat(110) };
    const r = runBacktest(
      series,
      strategy({
        weights: weights({ core: 45, bond: 25, dividend: 20, satellite: 5, cash: 5 }),
        lump: 100_003,
        trancheMonths: 3,
        monthly: 3_333,
        rebalanceYearly: true,
      }),
    );
    expect(r?.maxDrawdown).toBe(0);
    expect(r?.volatility).toBe(0);
    expect(r?.worstYear).toBe(0);
    expect(r?.xirr).toBe(0);
  });

  it("throws when the window has fewer months than the tranche count", () => {
    // About 60 days from 2021-01-04: January, February, March → 3 contribution months < 6.
    const core = tr(
      Array.from({ length: 60 }, (_, k) => [
        new Date(Date.UTC(2021, 0, 4 + k)).toISOString().slice(0, 10),
        1,
      ]),
    );
    expect(() => runBacktest({ core }, strategy({ lump: 600, trancheMonths: 6 }))).toThrow(
      RangeError,
    );
    expect(() =>
      simulate(
        { dates: core.map((p) => p.date), prices: { core: core.map((p) => p.index) } },
        strategy({ lump: 600, trancheMonths: 6 }),
      ),
    ).toThrow(RangeError);
  });

  it("merges a month without a trading day into the next month's first trading day", () => {
    // No February dates: February's and March's contributions both land on 2021-03-01.
    const core = tr([
      ["2021-01-04", 1],
      ["2021-01-20", 1],
      ["2021-03-01", 1],
      ["2021-04-01", 1],
    ]);
    const monthly = runBacktest({ core }, strategy({ monthly: 100 }));
    expect(monthly?.valueSeries.map((p) => p.invested)).toEqual([100, 100, 300, 400]);
    // The gap month still counts as a tranche month: 300 over 3 months is fully invested by March.
    const staged = runBacktest({ core }, strategy({ lump: 300, trancheMonths: 3 }));
    expect(staged?.valueSeries.map((p) => p.invested)).toEqual([100, 100, 300, 300]);
  });

  it("rebalances a window starting on Feb 29 on the first trading day on or after Mar 1", () => {
    // addYears(2020-02-29, 1) = 2021-03-01. Core 1 → 2 → 2 → 3, bond flat; lump 1000 at 50/50.
    const dates = ["2020-02-29", "2020-08-03", "2021-02-26", "2021-03-01"];
    const s = strategy({
      weights: weights({ core: 50, bond: 50 }),
      lump: 1000,
      rebalanceYearly: true,
    });
    const prices = (n: number) => ({
      core: [1, 2, 2, 3].slice(0, n),
      bond: [1, 1, 1, 1].slice(0, n),
    });
    // On 2021-02-26 nothing has been rebalanced yet: 500 / 500 units.
    const before = simulate({ dates: dates.slice(0, 3), prices: prices(3) }, s);
    expect(before.units.core).toBe(500);
    expect(before.units.bond).toBe(500);
    // On 2021-03-01: 500 × 3 + 500 = 2000 → 1000 each → core 1000 / 3 units, bond 1000 units.
    const after = simulate({ dates, prices: prices(4) }, s);
    expect(after.units.core).toBeCloseTo(1000 / 3, 9);
    expect(after.units.bond).toBeCloseTo(1000, 9);
  });

  it("rebalances after a contribution on the same day", () => {
    // Dates 2021-01-04, 2021-06-01, 2022-01-04; lump 1000 + monthly 100, core 1 → 2 → 2, bond 1.
    // Day 1: 1100 → 550 core units, 550 bond units.
    // 2021-06-01 takes months 2–6 (Feb–Jun): 500 → +125 core units (250 / 2), +250 bond → 675 / 800.
    // 2022-01-04 takes months 7–13 (Jul–Jan) and is the anniversary: value 675 × 2 + 800 = 2150,
    // +700 → 2850, then rebalanced to 1425 / 1425 → core 712.5 units, bond 1425 units.
    const s = strategy({
      weights: weights({ core: 50, bond: 50 }),
      lump: 1000,
      monthly: 100,
      rebalanceYearly: true,
    });
    const sim = simulate(
      {
        dates: ["2021-01-04", "2021-06-01", "2022-01-04"],
        prices: { core: [1, 2, 2], bond: [1, 1, 1] },
      },
      s,
    );
    expect(sim.invested).toEqual([1100, 1600, 2300]);
    expect(sim.units.core).toBeCloseTo(712.5, 9);
    expect(sim.units.bond).toBeCloseTo(1425, 9);
    expect(sim.values[2]).toBeCloseTo(2850, 9);
  });
});
