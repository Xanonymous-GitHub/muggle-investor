import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { priceBars } from "@/db/schema";
import {
  FIRST_DATES,
  LAST_BAR,
  PLAN_NOW,
  seedPlanMarket,
  seedShortCommonHistory,
} from "../../test/helpers/plan-fixtures";
import { createTestDb } from "../../test/helpers/test-db";
import { DataUnavailableError, planPortfolio } from "./plan-service";
import { type PlanRequest, type PlanResponse, planResponseSchema } from "./schema";

const LEVEL_3: PlanRequest["answers"] = {
  age: "age-40-49",
  horizon: "horizon-5-10y",
  income: "income-stable",
  reserve: "reserve-3-6m",
  loss: "loss-hold",
};
const LEVEL_5: PlanRequest["answers"] = {
  age: "age-under-30",
  horizon: "horizon-10y-plus",
  income: "income-stable",
  reserve: "reserve-6m-plus",
  loss: "loss-add-lots",
};

const REQUEST: PlanRequest = {
  answers: LEVEL_3,
  lump: 600_000,
  monthly: 10_000,
  monthlyExpenses: 30_000,
  existingReserve: 100_000,
};

const DIVIDEND_WARNING = "高股息標的暫時沒有符合條件的 ETF，高股息部位以現金計算";
const BOND_WARNING = "債券標的暫時沒有符合條件的 ETF，債券部位以現金計算";
/** Level 2 through the horizon cap (1–3 years); its allocation has no satellite. */
const LEVEL_2: PlanRequest["answers"] = { ...LEVEL_3, horizon: "horizon-1-3y" };

const SATELLITE = "衛星部位以核心報酬代替，實際風險更高";
const FIXED = [
  "含配息再投入，不計手續費與稅",
  "過去表現不代表未來",
  "年化報酬含投入時點（資金加權）",
];
const ASSUMPTIONS = [SATELLITE, ...FIXED];
const SAME_MONEY = "三種試算投入的總金額相同，只差在投入時點";
const EQUITY_ONLY = "只有股票的試算不含債券與現金";

function asPlan(response: PlanResponse) {
  if (response.kind !== "plan") throw new Error(`expected a plan, got ${response.kind}`);
  return response;
}

describe("planPortfolio", () => {
  let db: Db;
  const plan = (request: PlanRequest) => planPortfolio({ db, now: PLAN_NOW }, request);

  beforeEach(async () => {
    db = await createTestDb();
  });

  describe("with three years of common history", () => {
    beforeEach(async () => {
      await seedPlanMarket(db);
    });

    it("returns reserve_only without scenarios when the reserve gap takes the whole lump", async () => {
      const response = await plan({ ...REQUEST, lump: 50_000, existingReserve: 0 });
      expect(response.kind).toBe("reserve_only");
      expect(response).not.toHaveProperty("scenarios");
      expect(response.amounts.reserveOnly).toBe(true);
      expect(response.assumptions).toEqual(ASSUMPTIONS);
      expect(planResponseSchema.parse(response)).toEqual(response);
    });

    it("plans a level-3 request over the primaries' common window", async () => {
      const response = asPlan(await plan(REQUEST));
      expect(response.profile.level).toBe(3);
      expect(response.window.symbols).toEqual(["0050", "00679B", "0056"]);
      expect(response.window.from).toBe(FIRST_DATES["00679B"]);
      expect(response.window.to).toBe(LAST_BAR);
      expect(response.window.years).toBe(3.8);
      expect(response.instruments).toEqual([
        { category: "core", symbol: "0050", name: "元大台灣50", alternate: null },
        { category: "bond", symbol: "00679B", name: "元大美債20年", alternate: null },
        { category: "dividend", symbol: "0056", name: "元大高股息", alternate: null },
      ]);
      expect(response.rhythm).toEqual({ trancheMonths: 6 });

      const { lump, dca, plan: staged } = response.scenarios;
      expect(lump.invested).toBe(dca.invested);
      expect(staged.invested).toBe(lump.invested);
      expect(staged.finalValue).toBeGreaterThan(0);
      for (const scenario of [lump, dca, staged]) {
        expect(scenario.from).toBe(response.window.from);
        expect(Number.isInteger(scenario.finalValue)).toBe(true);
        expect(scenario.valueSeries.every((p) => Number.isInteger(p.value))).toBe(true);
        // A monthly amount makes every scenario money-weighted: no CAGR.
        expect(scenario.cagr).toBeNull();
      }
      expect(response.warnings).toEqual([]);
      expect(response.assumptions).toEqual([...ASSUMPTIONS, SAME_MONEY, EQUITY_ONLY]);
      expect(planResponseSchema.parse(response)).toEqual(response);
    });

    it("leaves out the satellite assumption at levels without a satellite slice", async () => {
      const reserveOnly = await plan({
        ...REQUEST,
        answers: LEVEL_2,
        lump: 50_000,
        existingReserve: 0,
      });
      expect(reserveOnly.profile.level).toBe(2);
      expect(reserveOnly.assumptions).toEqual(FIXED);

      const response = asPlan(await plan({ ...REQUEST, answers: LEVEL_2 }));
      expect(response.amounts.slices.satellite).toBe(0);
      expect(response.assumptions).toEqual([...FIXED, SAME_MONEY, EQUITY_ONLY]);
    });

    it("adds an equity-only run from the first day core and dividend both trade", async () => {
      const response = asPlan(await plan(REQUEST));
      expect(response.equityOnly).not.toBeNull();
      expect(response.equityOnly?.from).toBe(FIRST_DATES["0056"]);
      expect(response.equityOnly?.years).toBe(6.4);
      expect(response.equityOnly?.lump.invested).toBe(response.equityOnly?.plan.invested);
    });

    it("leaves equityOnly null when there is no bond and the windows already match", async () => {
      const response = asPlan(await plan({ ...REQUEST, answers: LEVEL_5 }));
      expect(response.profile.level).toBe(5);
      expect(response.window.symbols).toEqual(["0050", "0056"]);
      expect(response.window.from).toBe(FIRST_DATES["0056"]);
      expect(response.equityOnly).toBeNull();
      // No equity-only run, so no equity-only disclosure.
      expect(response.assumptions).toEqual([...ASSUMPTIONS, SAME_MONEY]);
    });

    it("reports CAGR for the lump scenario when nothing is added monthly", async () => {
      const response = asPlan(await plan({ ...REQUEST, monthly: 0 }));
      expect(response.scenarios.lump.cagr).not.toBeNull();
      expect(response.scenarios.dca.cagr).toBeNull();
    });

    it("treats a lump smaller than the tranche count as a single tranche", async () => {
      const response = asPlan(await plan({ ...REQUEST, lump: 5, monthly: 1 }));
      expect(response.scenarios.dca.invested).toBe(response.scenarios.lump.invested);
      // The rule says 6, but 5 TWD cannot be split into 6 whole tranches: 1 is what ran.
      expect(response.amounts.trancheMonths).toBe(6);
      expect(response.rhythm).toEqual({ trancheMonths: 1 });
    });

    it("downsamples every value series to month-end points, keeping both ends", async () => {
      const response = asPlan(await plan(REQUEST));
      const runs = [
        ...Object.values(response.scenarios),
        ...Object.values(response.equityOnly ?? {}).filter(
          (v): v is (typeof response.scenarios)["lump"] => typeof v === "object",
        ),
      ];
      expect(runs).toHaveLength(6);
      for (const run of runs) {
        const series = run.valueSeries;
        // ~3.8 or ~6.4 years of weekdays would be ~1000-1700 points; month ends are ~50-80.
        expect(series.length).toBeLessThan(90);
        expect(series[0]?.date).toBe(run.from);
        expect(series.at(-1)?.date).toBe(run.to);
        expect(series.at(-1)?.value).toBe(run.finalValue);
        expect(series.at(-1)?.invested).toBe(run.invested);
        // Between the ends, one point per month, each the month's last trading day.
        const middle = series.slice(1, -1);
        const months = middle.map((p) => p.date.slice(0, 7));
        expect(new Set(months).size).toBe(months.length);
        for (const point of middle) {
          const [y, m] = point.date.split("-").map(Number) as [number, number];
          const nextMonth = new Date(Date.UTC(y, m, 1));
          const gap = (nextMonth.getTime() - Date.parse(`${point.date}T00:00:00Z`)) / 86_400_000;
          expect(gap).toBeLessThanOrEqual(3); // weekday fixture: last weekday is ≤ 3 days before
        }
      }
    });

    it("moves the bond weight to cash with a warning when no bond ETF qualifies", async () => {
      await db.delete(priceBars).where(eq(priceBars.symbol, "00679B"));
      const response = asPlan(await plan(REQUEST));
      expect(response.warnings).toEqual([BOND_WARNING]);
      expect(response.amounts.slices.bond).toBe(0);
      expect(response.amounts.slices.cash).toBe(180_000);
      expect(response.window.symbols).toEqual(["0050", "0056"]);
      expect(response.instruments.map((i) => i.category)).toEqual(["core", "dividend"]);
      expect(response.equityOnly).not.toBeNull();
    });

    it("moves the dividend weight to cash with a warning when no dividend ETF qualifies", async () => {
      await db.delete(priceBars).where(eq(priceBars.symbol, "0056"));
      const response = asPlan(await plan(REQUEST));
      expect(response.warnings).toEqual([DIVIDEND_WARNING]);
      expect(response.amounts.slices.dividend).toBe(0);
      expect(response.amounts.slices.cash).toBe(150_000);
      expect(response.window.symbols).toEqual(["0050", "00679B"]);
      expect(response.instruments.map((i) => i.category)).toEqual(["core", "bond"]);
      // Equity-only is then all core, from core's first day.
      expect(response.equityOnly?.from).toBe(FIRST_DATES["0050"]);
    });

    it("throws DataUnavailableError without data in the message when no core ETF qualifies", async () => {
      await db.delete(priceBars).where(eq(priceBars.symbol, "0050"));
      const error = await plan(REQUEST).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DataUnavailableError);
      expect((error as Error).name).toBe("DataUnavailableError");
      expect((error as Error).message).not.toMatch(/\d/);
    });
  });

  it("returns insufficient_history when the primaries share fewer than 365 days", async () => {
    await seedShortCommonHistory(db);
    const response = await plan(REQUEST);
    expect(response.kind).toBe("insufficient_history");
    expect(planResponseSchema.parse(response)).toEqual(response);
  });
});
