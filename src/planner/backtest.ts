// Backtest simulation (spec 「補充決定」: 衛星部位的試算, 指標的算法, 分批與每月投入的合併). Pure.
// Holdings are units per slice (value = units × that slice's total-return index). Satellite is
// priced with the core series and cash keeps a constant index of 1. A portfolio unit value
// (time-weighted, starting at 1) carries the risk metrics: each contribution buys portfolio units
// at that day's unit value, so money added never lifts or masks drawdown, volatility or worst year.
// Fees and taxes are not modelled.
import {
  addYears,
  annualVolatility,
  type CashFlow,
  cagr,
  daysBetween,
  maxDrawdown,
  worstRollingYear,
  xirr,
} from "./metrics";
import type { Slice } from "./rules/allocation";
import type { TrPoint } from "./total-return";

export type Strategy = {
  /** Percents per slice, summing to 100. */
  weights: Record<Slice, number>;
  lump: number;
  trancheMonths: number;
  monthly: number;
  rebalanceYearly: boolean;
};

type SeriesKey = "core" | "bond" | "dividend";
export type BacktestSeries = Partial<Record<SeriesKey, readonly TrPoint[]>>;

export type BacktestResult = {
  from: string;
  to: string;
  invested: number;
  finalValue: number;
  xirr: number | null;
  /** Only for a single contribution (whole lump on day 1, nothing monthly). */
  cagr: number | null;
  maxDrawdown: number;
  volatility: number;
  worstYear: number | null;
  valueSeries: { date: string; value: number; invested: number }[];
};

export type AlignedPrices = {
  dates: readonly string[];
  prices: Partial<Record<SeriesKey, readonly number[]>>;
};

export type Simulation = {
  values: number[];
  unitValues: number[];
  invested: number[];
  /** Per-day contribution amounts (0 on days without one). */
  contributions: number[];
  /** Slice units held after the last day. */
  units: Record<Slice, number>;
};

const SLICES: readonly Slice[] = ["core", "bond", "dividend", "satellite", "cash"];
/** Which series prices each slice; null = cash at a constant index of 1. */
const SERIES_FOR: Record<Slice, SeriesKey | null> = {
  core: "core",
  bond: "bond",
  dividend: "dividend",
  satellite: "core",
  cash: null,
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Dates present in every series (ascending) and each series' index on those dates. */
export function alignOnCommonDates(series: readonly (readonly TrPoint[])[]): {
  dates: string[];
  indices: number[][];
} {
  const maps = series.map((points) => new Map(points.map((p) => [p.date, p.index])));
  const [first, ...rest] = maps;
  if (!first) return { dates: [], indices: [] };
  const dates = [...first.keys()].filter((d) => rest.every((m) => m.has(d))).sort();
  return { dates, indices: maps.map((m) => dates.map((d) => m.get(d) as number)) };
}

/** Index of the first date on or after `target`, or `dates.length` if none. */
function firstOnOrAfter(dates: readonly string[], target: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((dates[mid] as string) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function monthStart(date: string, monthsLater: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + monthsLater, 1)).toISOString().slice(0, 10);
}

/** Day index of contribution month 1, 2, …: the window's first day, then each month's first trading day. */
function contributionDays(dates: readonly string[]): number[] {
  const days = [0];
  for (let k = 1; ; k++) {
    const day = firstOnOrAfter(dates, monthStart(dates[0] as string, k));
    if (day >= dates.length) return days;
    days.push(day);
  }
}

/** Day indices of the first trading day on or after each anniversary of the window start. */
function anniversaryDays(dates: readonly string[]): Set<number> {
  const days = new Set<number>();
  for (let n = 1; ; n++) {
    const day = firstOnOrAfter(dates, addYears(dates[0] as string, n));
    if (day >= dates.length) return days;
    days.add(day);
  }
}

/**
 * Contribution per day: the lump split over the first `trancheMonths` months (remainder in
 * month 1) plus `monthly`. Throws a RangeError when a lump is staged over more months than the
 * window has, so no tranche is silently dropped. A month without a trading day still counts:
 * its contribution lands on the next month's first trading day.
 */
function contributionSchedule(dates: readonly string[], strategy: Strategy): number[] {
  const { lump, trancheMonths, monthly } = strategy;
  const days = contributionDays(dates);
  if (lump > 0 && days.length < trancheMonths) {
    throw new RangeError(
      `window has ${days.length} contribution months, fewer than trancheMonths ${trancheMonths}`,
    );
  }
  const tranche = Math.floor(lump / trancheMonths);
  const amounts = new Array<number>(dates.length).fill(0);
  days.forEach((day, month) => {
    let amount = monthly;
    if (month < trancheMonths)
      amount += tranche + (month === 0 ? lump - tranche * trancheMonths : 0);
    amounts[day] = (amounts[day] as number) + amount;
  });
  return amounts;
}

function validate(strategy: Strategy): void {
  const { weights, lump, trancheMonths, monthly } = strategy;
  if (SLICES.some((s) => !(weights[s] >= 0))) throw new RangeError("weights must be non-negative");
  const total = SLICES.reduce((acc, s) => acc + weights[s], 0);
  if (Math.abs(total - 100) > 1e-9) throw new RangeError(`weights must sum to 100, got ${total}`);
  for (const [name, value] of [
    ["lump", lump],
    ["monthly", monthly],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative whole number, got ${value}`);
    }
  }
  if (!Number.isSafeInteger(trancheMonths) || trancheMonths < 1) {
    throw new RangeError(`trancheMonths must be a whole number ≥ 1, got ${trancheMonths}`);
  }
}

/**
 * Day-by-day holdings on already-aligned prices. Throws a RangeError for an invalid strategy, a
 * weighted slice without prices, or more tranche months than the window has.
 */
export function simulate(aligned: AlignedPrices, strategy: Strategy): Simulation {
  validate(strategy);
  return simulateValid(aligned, strategy);
}

function simulateValid(aligned: AlignedPrices, strategy: Strategy): Simulation {
  const { dates, prices } = aligned;
  const active = SLICES.filter((s) => strategy.weights[s] > 0).map((slice) => {
    const key = SERIES_FOR[slice];
    const series = key === null ? null : prices[key];
    if (series === undefined) throw new RangeError(`no prices for slice ${slice}`);
    return { slice, share: strategy.weights[slice] / 100, series };
  });
  const units = Object.fromEntries(SLICES.map((s) => [s, 0])) as Record<Slice, number>;
  const priceOf = (series: readonly number[] | null, day: number) =>
    series === null ? 1 : (series[day] as number);

  const contributions = contributionSchedule(dates, strategy);
  const rebalanceOn = strategy.rebalanceYearly ? anniversaryDays(dates) : new Set<number>();
  const values: number[] = [];
  const unitValues: number[] = [];
  const invested: number[] = [];
  let portfolioUnits = 0;
  let totalIn = 0;

  for (let day = 0; day < dates.length; day++) {
    let value = 0;
    for (const a of active) value += units[a.slice] * priceOf(a.series, day);
    const unitValue = portfolioUnits > 0 ? value / portfolioUnits : 1;

    const amount = contributions[day] as number;
    if (amount > 0) {
      portfolioUnits += amount / unitValue;
      for (const a of active) units[a.slice] += (amount * a.share) / priceOf(a.series, day);
      value += amount;
      totalIn += amount;
    }
    if (rebalanceOn.has(day)) {
      for (const a of active) units[a.slice] = (value * a.share) / priceOf(a.series, day);
    }
    values.push(value);
    unitValues.push(unitValue);
    invested.push(totalIn);
  }
  return { values, unitValues, invested, contributions, units };
}

/**
 * Runs `strategy` over the dates every series it uses has in common; null if fewer than 2 or a
 * weighted slice's series is missing. Throws like `simulate`.
 */
export function runBacktest(series: BacktestSeries, strategy: Strategy): BacktestResult | null {
  validate(strategy);
  const keys = [
    ...new Set(
      SLICES.filter((s) => strategy.weights[s] > 0)
        .map((s) => SERIES_FOR[s])
        .filter((k): k is SeriesKey => k !== null),
    ),
  ];
  if (keys.some((k) => series[k] === undefined)) return null;
  const { dates, indices } = alignOnCommonDates(keys.map((k) => series[k] as readonly TrPoint[]));
  if (dates.length < 2) return null;
  const prices = Object.fromEntries(keys.map((k, i) => [k, indices[i]]));
  const sim = simulateValid({ dates, prices }, strategy);
  return summarise(dates, sim, strategy);
}

function summarise(dates: readonly string[], sim: Simulation, strategy: Strategy): BacktestResult {
  const from = dates[0] as string;
  const to = dates[dates.length - 1] as string;
  const finalValue = sim.values[sim.values.length - 1] as number;
  const invested = sim.invested[sim.invested.length - 1] as number;

  const flows: CashFlow[] = [];
  sim.contributions.forEach((amount, day) => {
    if (amount > 0) flows.push({ date: dates[day] as string, amount: -amount });
  });
  flows.push({ date: to, amount: finalValue });

  const single = strategy.lump > 0 && strategy.monthly === 0 && strategy.trancheMonths === 1;
  return {
    from,
    to,
    invested: round2(invested),
    finalValue: round2(finalValue),
    xirr: xirr(flows),
    cagr: single ? cagr(strategy.lump, finalValue, daysBetween(from, to)) : null,
    maxDrawdown: maxDrawdown(sim.unitValues),
    volatility: annualVolatility(sim.unitValues),
    worstYear: worstRollingYear(
      dates.map((date, i) => ({ date, value: sim.unitValues[i] as number })),
    ),
    valueSeries: dates.map((date, i) => ({
      date,
      value: round2(sim.values[i] as number),
      invested: round2(sim.invested[i] as number),
    })),
  };
}
