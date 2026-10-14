import type { Db } from "@/db/client";
import { upsertEtfUniverse } from "@/db/repositories/etf-universe";
import { upsertCorporateActions, upsertPriceBars } from "@/db/repositories/prices";
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
