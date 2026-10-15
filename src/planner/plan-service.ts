// Plan service behind POST /api/plan: questionnaire → amounts → instruments → backtests.
// Every number comes from stored data or the deterministic planner modules; nothing is stored.
import type { Db } from "@/db/client";
import { listEtfUniverse } from "@/db/repositories/etf-universe";
import { getCorporateActions, getPriceBars, getPriceStats } from "@/db/repositories/prices";
import { toTaipei } from "@/market-clock/market-clock";
import { planAmounts, splitByLargestRemainder } from "./amounts";
import { type BacktestResult, type BacktestSeries, runBacktest, type Strategy } from "./backtest";
import { daysBetween } from "./metrics";
import { ALLOCATION_TABLE, type Slice } from "./rules/allocation";
import { CATEGORY_MEMBERS } from "./rules/instruments";
import { scoreProfile } from "./rules/questionnaire";
import type { PlanBacktest, PlanRequest, PlanResponse } from "./schema";
import { type Candidate, type Category, selectInstruments } from "./selection";
import { buildTotalReturnIndex, type TrPoint } from "./total-return";

export class DataUnavailableError extends Error {
  override name = "DataUnavailableError";
  constructor() {
    super("No eligible core instrument has price data");
  }
}

/** Shown only when the profile holds a satellite slice (levels 3-5). */
const SATELLITE_PROXY = "衛星部位以核心報酬代替，實際風險更高";

export const ASSUMPTIONS = [
  "含配息再投入，不計手續費與稅",
  "過去表現不代表未來",
  "年化報酬含投入時點（資金加權）",
] as const;

/** All three scenarios put in the same money and differ only in when the lump goes in. */
const SAME_MONEY = "三種試算投入的總金額相同，只差在投入時點";
/** Shown only when the response carries an equity-only run. */
const EQUITY_ONLY = "只有股票的試算不含債券與現金";

const WARNING_NO_PRIMARY: Record<Exclude<Category, "core">, string> = {
  bond: "債券標的暫時沒有符合條件的 ETF，債券部位以現金計算",
  dividend: "高股息標的暫時沒有符合條件的 ETF，高股息部位以現金計算",
};

const CATEGORIES: readonly Category[] = ["core", "bond", "dividend"];
const LUMP_TRANCHES = 1;
const DCA_TRANCHES = 12;
const MIN_WINDOW_DAYS = 365;
const EARLIEST = "1900-01-01";

type Primary = { category: Category; candidate: Candidate; alternate: string | null };

const yearsBetween = (from: string, to: string) =>
  Math.round((daysBetween(from, to) / 365.25) * 10) / 10;

/** A lump smaller than its tranche count cannot be split into whole TWD: one tranche instead. */
const usableTranches = (lump: number, months: number) => (lump < months ? 1 : months);

/** The first point, each month's last point and the last point (so the chart ends at finalValue). */
function monthEnds<T extends { date: string }>(points: readonly T[]): T[] {
  return points.filter(
    (point, i) =>
      i === 0 ||
      i === points.length - 1 ||
      point.date.slice(0, 7) !== points[i + 1]?.date.slice(0, 7),
  );
}

/**
 * The API view of a run (R-P5, R-P7): money in whole TWD and the value series cut to month-end
 * points. Ratios stay as computed from the daily data.
 */
function toWholeMoney(result: BacktestResult): PlanBacktest {
  return {
    ...result,
    invested: Math.round(result.invested),
    finalValue: Math.round(result.finalValue),
    valueSeries: monthEnds(result.valueSeries).map((p) => ({
      date: p.date,
      value: Math.round(p.value),
      invested: Math.round(p.invested),
    })),
  };
}

/** Every category member with stored bars, with its price stats and listed name. */
export async function loadCandidates(db: Db): Promise<Candidate[]> {
  const names = new Map((await listEtfUniverse(db)).map((row) => [row.symbol, row.name]));
  const symbols = CATEGORIES.flatMap((category) => CATEGORY_MEMBERS[category]);
  const candidates: Candidate[] = [];
  for (const symbol of symbols) {
    const stats = await getPriceStats(db, symbol);
    // A member missing from the universe keeps its symbol as the name (still curated by PR).
    if (stats) candidates.push({ symbol, name: names.get(symbol) ?? symbol, stats });
  }
  return candidates;
}

async function loadPrimaries(db: Db, asOf: string): Promise<Primary[]> {
  const selection = selectInstruments(await loadCandidates(db), asOf);
  return CATEGORIES.flatMap((category) => {
    const { primary, alternate } = selection[category];
    return primary ? [{ category, candidate: primary, alternate: alternate?.symbol ?? null }] : [];
  });
}

async function totalReturn(db: Db, symbol: string, asOf: string): Promise<TrPoint[]> {
  const [bars, actions] = await Promise.all([
    getPriceBars(db, symbol, EARLIEST, asOf),
    getCorporateActions(db, symbol),
  ]);
  return buildTotalReturnIndex(bars, actions);
}

type Scenarios = { lump: PlanBacktest; dca: PlanBacktest; plan: PlanBacktest };

/**
 * Lump / 12-month DCA / rule rhythm on the same weights and money. Null when the series share
 * fewer than MIN_WINDOW_DAYS: a year-long window always has at least 12 contribution months, so
 * no tranche count used here can outrun it.
 */
function runScenarios(
  series: BacktestSeries,
  weights: Record<Slice, number>,
  lump: number,
  monthly: number,
  planTranches: number,
): Scenarios | null {
  const run = (trancheMonths: number) => {
    const strategy: Strategy = {
      weights,
      lump,
      monthly,
      trancheMonths: usableTranches(lump, trancheMonths),
      rebalanceYearly: true,
    };
    return runBacktest(series, strategy);
  };
  const lumpRun = run(LUMP_TRANCHES);
  if (!lumpRun || daysBetween(lumpRun.from, lumpRun.to) < MIN_WINDOW_DAYS) return null;
  const dca = run(DCA_TRANCHES);
  const plan = run(planTranches);
  if (!dca || !plan) return null;
  return { lump: toWholeMoney(lumpRun), dca: toWholeMoney(dca), plan: toWholeMoney(plan) };
}

/** Core and dividend scaled to 100%, satellite counted as core; no bond, no cash. */
function equityWeights(table: Record<Slice, number>): Record<Slice, number> {
  const core = table.core + table.satellite;
  const total = core + table.dividend;
  return {
    core: (core / total) * 100,
    bond: 0,
    dividend: (table.dividend / total) * 100,
    satellite: 0,
    cash: 0,
  };
}

/**
 * Builds the plan for one questionnaire. Throws DataUnavailableError when no core instrument
 * qualifies; reserve-only answers never touch market data.
 */
export async function planPortfolio(
  deps: { db: Db; now: Date },
  request: PlanRequest,
): Promise<PlanResponse> {
  const { db, now } = deps;
  const profile = scoreProfile(request.answers);
  const table = ALLOCATION_TABLE[profile.level];
  const assumptions: string[] = [...(table.satellite > 0 ? [SATELLITE_PROXY] : []), ...ASSUMPTIONS];
  const baseAmounts = planAmounts({
    lump: request.lump,
    monthly: request.monthly,
    monthlyExpenses: request.monthlyExpenses,
    existingReserve: request.existingReserve,
    incomeOptionId: request.answers.income,
    level: profile.level,
  });
  if (baseAmounts.reserveOnly) {
    return { kind: "reserve_only", profile, amounts: baseAmounts, warnings: [], assumptions };
  }

  const asOf = toTaipei(now).date;
  const primaries = await loadPrimaries(db, asOf);
  const byCategory = new Map(primaries.map((p) => [p.category, p]));
  if (!byCategory.has("core")) throw new DataUnavailableError();

  // A weighted slice without an eligible primary is held as cash, with a warning.
  const weights = { ...table };
  const warnings: string[] = [];
  for (const category of ["bond", "dividend"] as const) {
    if (weights[category] > 0 && !byCategory.has(category)) {
      weights.cash += weights[category];
      weights[category] = 0;
      warnings.push(WARNING_NO_PRIMARY[category]);
    }
  }
  const amounts = {
    ...baseAmounts,
    slices: splitByLargestRemainder(baseAmounts.investable, weights),
  };

  // Core always carries weight (satellite is priced with it too).
  const used = primaries.filter((p) => p.category === "core" || weights[p.category] > 0);
  const series: BacktestSeries = {};
  for (const p of used) series[p.category] = await totalReturn(db, p.candidate.symbol, asOf);

  const lump = amounts.investable;
  const { monthly } = request;
  const scenarios = runScenarios(series, weights, lump, monthly, amounts.trancheMonths);
  if (!scenarios) {
    return { kind: "insufficient_history", profile, amounts, warnings, assumptions };
  }
  const { from, to } = scenarios.lump;

  let equityOnly: Extract<PlanResponse, { kind: "plan" }>["equityOnly"] = null;
  const dividend = byCategory.get("dividend");
  const equitySeries: BacktestSeries = { core: series.core };
  if (dividend) {
    equitySeries.dividend =
      series.dividend ?? (await totalReturn(db, dividend.candidate.symbol, asOf));
  }
  const equity = runScenarios(
    equitySeries,
    equityWeights(dividend ? table : { ...table, dividend: 0 }),
    lump,
    monthly,
    amounts.trancheMonths,
  );
  // Nothing to add when the profile holds no bond and the equity run starts on the same day.
  if (equity && !(table.bond === 0 && equity.lump.from === from)) {
    equityOnly = {
      from: equity.lump.from,
      years: yearsBetween(equity.lump.from, equity.lump.to),
      ...equity,
    };
  }

  return {
    kind: "plan",
    profile,
    amounts,
    instruments: used.map((p) => ({
      category: p.category,
      symbol: p.candidate.symbol,
      name: p.candidate.name,
      alternate: p.alternate,
    })),
    rhythm: { trancheMonths: usableTranches(lump, amounts.trancheMonths) },
    window: {
      from,
      to,
      years: yearsBetween(from, to),
      symbols: used.map((p) => p.candidate.symbol),
    },
    scenarios,
    equityOnly,
    warnings,
    assumptions: [...assumptions, SAME_MONEY, ...(equityOnly ? [EQUITY_ONLY] : [])],
  };
}
