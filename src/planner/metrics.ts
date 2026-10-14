// Backtest metrics (spec 「指標的算法」). Pure; dates are YYYY-MM-DD read as UTC days.
// Money-weighted return = XIRR on actual/365; the risk metrics take a unit-value series so later
// contributions never lift or mask them.

export type CashFlow = { date: string; amount: number };

const DAY_MS = 86_400_000;
const TRADING_DAYS = 252;
const MAX_ITERATIONS = 100;
const TOLERANCE = 1e-10;

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Same month and day `years` later (UTC); Feb 29 rolls to Mar 1 in a non-leap year. */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

/** Annualised money-weighted return (actual/365), solved by Newton's method from 10 %. */
export function xirr(flows: readonly CashFlow[]): number | null {
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const first = flows.reduce((min, f) => (f.date < min ? f.date : min), flows[0]?.date ?? "");
  const terms = flows.map((f) => ({ t: daysBetween(first, f.date) / 365, amount: f.amount }));

  let rate = 0.1;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let npv = 0;
    let slope = 0;
    for (const { t, amount } of terms) {
      const discount = (1 + rate) ** -t;
      npv += amount * discount;
      slope -= (t * amount * discount) / (1 + rate);
    }
    if (!Number.isFinite(npv) || !Number.isFinite(slope) || slope === 0) return null;
    let next = rate - npv / slope;
    // Stay above −100 %: step halfway towards the boundary instead of past it.
    if (next <= -1) next = (rate - 1) / 2;
    if (Math.abs(next - rate) < TOLERANCE) return next;
    rate = next;
  }
  return null;
}

/** Compound annual growth on actual/365. */
export function cagr(startValue: number, endValue: number, days: number): number | null {
  if (!(startValue > 0) || !(endValue > 0) || !(days >= 1)) return null;
  return (endValue / startValue) ** (365 / days) - 1;
}

/** Deepest fall from a running peak, as a non-positive fraction. */
export function maxDrawdown(values: readonly number[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    else worst = Math.min(worst, value / peak - 1);
  }
  return worst;
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
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
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
  return worst;
}
