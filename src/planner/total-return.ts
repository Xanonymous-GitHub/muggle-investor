// Total-return index (spec 「含息還原報酬」): raw closes with every distribution reinvested.
// Holding N shares at close_{t-1}, an action on the ex-date turns them into N × before/after shares
// (cash reinvested at the ex-date reference price `after`; a split scales the count the same way),
// so the day's wealth factor is close_t × Π(before_i / after_i) / close_{t-1}. No cash amount needed.
// Input hygiene: bars whose close is not a finite positive number (e.g. FinMind's zero-price rows
// for halted days) are dropped first and treated as missing, so an action dated on such a bar
// applies to the next valid bar; the rest are deduped by date (last valid occurrence wins).
import type { CorporateAction, PriceBar } from "@/sources/finmind";

export type TrPoint = { date: string; index: number };

const isPositive = (value: number) => Number.isFinite(value) && value > 0;

/** Index starts at 1 on the first bar. Actions dated on or before the first bar, or with a non-finite or non-positive price, are ignored. */
export function buildTotalReturnIndex(
  bars: readonly PriceBar[],
  actions: readonly CorporateAction[],
): TrPoint[] {
  const byDate = new Map<string, PriceBar>();
  for (const bar of bars) if (isPositive(bar.close)) byDate.set(bar.date, bar);
  const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  if (!first) return [];

  const pending = actions
    .filter((a) => a.exDate > first.date && isPositive(a.beforePrice) && isPositive(a.afterPrice))
    .sort((a, b) => a.exDate.localeCompare(b.exDate));

  const points: TrPoint[] = [{ date: first.date, index: 1 }];
  let index = 1;
  let next = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as PriceBar;
    const current = sorted[i] as PriceBar;
    // Every action whose ex-date falls in (prev.date, current.date] lands on this bar.
    let shareRatio = 1;
    while (next < pending.length && (pending[next] as CorporateAction).exDate <= current.date) {
      const action = pending[next] as CorporateAction;
      shareRatio *= action.beforePrice / action.afterPrice;
      next++;
    }
    index *= (current.close * shareRatio) / prev.close;
    points.push({ date: current.date, index });
  }
  return points;
}
