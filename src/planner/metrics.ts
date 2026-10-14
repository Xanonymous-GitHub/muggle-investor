// Backtest metrics (spec 「指標的算法」). Pure; dates are YYYY-MM-DD read as UTC days.
// Money-weighted return = XIRR on actual/365; the risk metrics take a unit-value series so later
// contributions never lift or mask them.

export type CashFlow = { date: string; amount: number };

const DAY_MS = 86_400_000;
const TRADING_DAYS = 252;
const MAX_BISECTIONS = 200;
const TOLERANCE = 1e-12;
const XIRR_LOWER = -0.999999;
const XIRR_UPPER = 1e6;
const NOISE = 1e-12;

/** Float noise around zero (e.g. a flat index after fractional splits) reads as exactly 0. */
const snapZero = (value: number) => (Math.abs(value) < NOISE ? 0 : value);

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Same month and day `years` later (UTC); Feb 29 rolls to Mar 1 in a non-leap year. */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

/**
 * Annualised money-weighted return (actual/365). Solves Σ aᵢ (1 + r)^(T − tᵢ) = 0 (future-value
 * form, T = the last flow's time) by bisection on a bracket from −99.9999 % upwards; null for
 * one-sign or non-finite flows, or when the root lies outside the bracket.
 */
export function xirr(flows: readonly CashFlow[]): number | null {
  if (flows.some((f) => !Number.isFinite(f.amount) || Number.isNaN(Date.parse(f.date))))
    return null;
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const last = (sorted[sorted.length - 1] as CashFlow).date;
  if ((sorted[0] as CashFlow).date === last) return null;
  const terms = sorted.map((f) => ({ years: daysBetween(f.date, last) / 365, amount: f.amount }));
  const fv = (rate: number) =>
    terms.reduce((acc, { years, amount }) => acc + amount * (1 + rate) ** years, 0);

  // Bracket: grow `hi` until the sign differs from the value at the lower bound.
  let lo = XIRR_LOWER;
  let hi = 1;
  const signLo = Math.sign(fv(lo));
  if (signLo === 0) return lo;
  while (Math.sign(fv(hi)) === signLo && hi < XIRR_UPPER) hi *= 2;
  const signHi = Math.sign(fv(hi));
  if (Number.isNaN(signHi) || signHi === signLo) return null;

  for (let i = 0; i < MAX_BISECTIONS && hi - lo > TOLERANCE; i++) {
    const mid = (lo + hi) / 2;
    const sign = Math.sign(fv(mid));
    if (sign === 0) return snapZero(mid);
    if (sign === signLo) lo = mid;
    else hi = mid;
  }
  return snapZero((lo + hi) / 2);
}

/** Compound annual growth on actual/365. */
export function cagr(startValue: number, endValue: number, days: number): number | null {
  if (!(startValue > 0) || !(endValue > 0) || !(days >= 1)) return null;
  return snapZero((endValue / startValue) ** (365 / days) - 1);
}

/** Deepest fall from a running peak, as a non-positive fraction. */
export function maxDrawdown(values: readonly number[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    else worst = Math.min(worst, value / peak - 1);
  }
  return snapZero(worst);
}

/** Population standard deviation of daily simple returns × √252. */
export function annualVolatility(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    returns.push((values[i] as number) / (values[i - 1] as number) - 1);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / returns.length;
  return snapZero(Math.sqrt(variance) * Math.sqrt(TRADING_DAYS));
}

/**
 * Worst return from any point to the first point on or after the same date one year later
 * (every window is at least 365 calendar days); null when no point has a year after it.
 */
export function worstRollingYear(
  points: readonly { date: string; value: number }[],
): number | null {
  let worst: number | null = null;
  let end = 0;
  for (const start of points) {
    const target = addYears(start.date, 1);
    while (end < points.length && (points[end] as { date: string }).date < target) end++;
    const last = points[end];
    if (!last) break;
    const r = last.value / start.value - 1;
    if (worst === null || r < worst) worst = r;
  }
  return worst === null ? null : snapZero(worst);
}
