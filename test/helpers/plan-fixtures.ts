import type { Db } from "@/db/client";
import { upsertEtfUniverse } from "@/db/repositories/etf-universe";
import { upsertCorporateActions, upsertPriceBars } from "@/db/repositories/prices";
import type { PlanReference } from "@/planner/plan-service";
import type { PriceBar } from "@/sources/finmind";

// Synthetic, deterministic market data for the planner service and route tests.

/** "Today" for every planner test: 2026-10-15 in Taipei. */
export const PLAN_NOW = new Date("2026-10-15T04:00:00Z");
export const LAST_BAR = "2026-10-14";

export const FIRST_DATES = { "0050": "2020-01-02", "0056": "2020-06-01", "00679B": "2023-01-03" };

const DAY_MS = 86_400_000;
const TURNOVER = 200_000_000;

const shiftDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Weekday bars from `from` to `to` inclusive, with a gentle trend and a wave. */
export function weekdayBars(
  symbol: string,
  from: string,
  to: string,
  base: number,
  drift: number,
): PriceBar[] {
  const bars: PriceBar[] = [];
  let i = 0;
  for (let date = from; date <= to; date = shiftDays(date, 1)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const close = base * (1 + drift * i) * (1 + 0.05 * Math.sin(i / 20));
    bars.push({
      symbol,
      date,
      open: close,
      high: close,
      low: close,
      close,
      volume: Math.round(TURNOVER / close),
      turnover: TURNOVER,
    });
    i++;
  }
  return bars;
}

async function seedUniverse(db: Db): Promise<void> {
  await upsertEtfUniverse(db, [
    { symbol: "0050", name: "元大台灣50", industry: "ETF", market: "twse" },
    { symbol: "0056", name: "元大高股息", industry: "ETF", market: "twse" },
    { symbol: "00679B", name: "元大美債20年", industry: "ETF債券型", market: "tpex" },
  ]);
}

/** 0050 and 0056 with 6+ years, 00679B with ~3.8 years; 0056 pays a yearly dividend. */
export async function seedPlanMarket(db: Db): Promise<void> {
  await seedUniverse(db);
  await upsertPriceBars(db, [
    ...weekdayBars("0050", FIRST_DATES["0050"], LAST_BAR, 100, 0.0004),
    ...weekdayBars("0056", FIRST_DATES["0056"], LAST_BAR, 30, 0.0001),
    ...weekdayBars("00679B", FIRST_DATES["00679B"], LAST_BAR, 40, 0.00002),
  ]);
  await upsertCorporateActions(db, [
    {
      symbol: "0056",
      exDate: "2023-07-17",
      kind: "dividend",
      beforePrice: 33,
      afterPrice: 31.5,
      cashDividend: 1.5,
    },
    {
      symbol: "0056",
      exDate: "2024-07-16",
      kind: "dividend",
      beforePrice: 34,
      afterPrice: 32.5,
      cashDividend: 1.5,
    },
  ]);
}

/**
 * Old enough for eligibility (one isolated bar per symbol, each on a different day) but only
 * ~200 days of history in common.
 */
export async function seedShortCommonHistory(db: Db): Promise<void> {
  await seedUniverse(db);
  const recentFrom = shiftDays(LAST_BAR, -200);
  await upsertPriceBars(db, [
    ...weekdayBars("0050", "2019-01-07", "2019-01-07", 100, 0),
    ...weekdayBars("0056", "2019-01-08", "2019-01-08", 30, 0),
    ...weekdayBars("00679B", "2019-01-09", "2019-01-09", 40, 0),
    ...weekdayBars("0050", recentFrom, LAST_BAR, 100, 0.0004),
    ...weekdayBars("0056", recentFrom, LAST_BAR, 30, 0.0001),
    ...weekdayBars("00679B", recentFrom, LAST_BAR, 40, 0.00002),
  ]);
}

/** A hand-written level-3 reference run (ratios as `planReference` returns them) for fact tests. */
export const LEVEL3_REFERENCE: PlanReference = {
  level: 3,
  asOf: "2026-10-15",
  weights: { core: 45, bond: 25, dividend: 20, satellite: 5, cash: 5 },
  instruments: [
    { category: "core", symbol: "0050", name: "元大台灣50" },
    { category: "bond", symbol: "00679B", name: "元大美債20年" },
    { category: "dividend", symbol: "0056", name: "元大高股息" },
  ],
  warnings: [],
  window: { from: "2017-01-17", to: "2026-10-14", years: 9.7 },
  metrics: { cagr: 0.0734512, maxDrawdown: -0.2345678, volatility: 0.1234, worstYear: -0.1567 },
  equityOnly: {
    from: "2008-01-02",
    years: 18.8,
    metrics: { cagr: 0.1012, maxDrawdown: -0.3301, volatility: 0.1702, worstYear: -0.2811 },
  },
};

export const BOND_AS_CASH_WARNING = "債券標的暫時沒有符合條件的 ETF，債券部位以現金計算";
export const DIVIDEND_AS_CASH_WARNING = "高股息標的暫時沒有符合條件的 ETF，高股息部位以現金計算";

/** `LEVEL3_REFERENCE` after its bond fund stopped qualifying: the bond slice is held as cash. */
export const LEVEL3_BOND_AS_CASH: PlanReference = {
  ...LEVEL3_REFERENCE,
  weights: { core: 45, bond: 0, dividend: 20, satellite: 5, cash: 30 },
  instruments: LEVEL3_REFERENCE.instruments.filter((i) => i.category !== "bond"),
  warnings: [BOND_AS_CASH_WARNING],
  window: { from: "2008-01-02", to: "2026-10-14", years: 18.8 },
  metrics: { cagr: 0.0921, maxDrawdown: -0.3512, volatility: 0.1388, worstYear: -0.3044 },
};

/**
 * `LEVEL3_REFERENCE` with no qualifying dividend fund: the dividend slice is held as cash and the
 * equity-only run holds the core fund alone.
 */
export const LEVEL3_DIVIDEND_AS_CASH: PlanReference = {
  ...LEVEL3_REFERENCE,
  weights: { core: 45, bond: 25, dividend: 0, satellite: 5, cash: 25 },
  instruments: LEVEL3_REFERENCE.instruments.filter((i) => i.category !== "dividend"),
  warnings: [DIVIDEND_AS_CASH_WARNING],
  metrics: { cagr: 0.0688, maxDrawdown: -0.2207, volatility: 0.1175, worstYear: -0.1493 },
  equityOnly: {
    from: "2003-06-30",
    years: 23.3,
    metrics: { cagr: 0.1105, maxDrawdown: -0.5571, volatility: 0.2133, worstYear: -0.4962 },
  },
};
