// Reserve gap, slice amounts and tranche count (spec 「配置」, 「緊急預備金」). Pure, whole-TWD money.
import { ALLOCATION_TABLE, reserveMonthsFor, type Slice } from "./rules/allocation";
import type { RiskLevel } from "./rules/questionnaire";
import { trancheMonthsFor } from "./rules/rhythm";

export type AmountInput = {
  lump: number;
  monthly: number;
  monthlyExpenses: number;
  existingReserve: number;
  incomeOptionId: string;
  level: RiskLevel;
};

export type AmountPlan = {
  reserveTarget: number;
  reserveGap: number;
  /** A reserve gap remains after the lump sum, so nothing is allocated yet. */
  reserveOnly: boolean;
  investable: number;
  slices: Record<Slice, number>;
  /**
   * The integer percents (sum 100) `slices` were split by. Here the level's table row; the plan
   * service replaces it with the post-fallback row (a slice with no eligible ETF moves to cash).
   */
  weights: Record<Slice, number>;
  trancheMonths: number;
  /** Months of the monthly amount to cover what the lump could not; null if never. */
  monthsToFillReserve: number | null;
};

const SLICE_ORDER: readonly Slice[] = ["core", "bond", "dividend", "satellite", "cash"];

function assertWholeMoney(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative whole number, got ${value}`);
  }
}

/** Integer split that sums exactly to `total`; leftover units go to the largest remainders. */
export function splitByLargestRemainder(
  total: number,
  weights: Record<Slice, number>,
): Record<Slice, number> {
  assertWholeMoney("total", total);
  const weightSum = SLICE_ORDER.reduce((acc, slice) => acc + weights[slice], 0);
  if (
    !Number.isFinite(weightSum) ||
    weightSum <= 0 ||
    SLICE_ORDER.some((s) => !(weights[s] >= 0))
  ) {
    throw new RangeError("weights must be non-negative and sum to more than 0");
  }
  const parts = SLICE_ORDER.map((slice, order) => {
    const exact = total * weights[slice];
    return { slice, order, floor: Math.floor(exact / weightSum), remainder: exact % weightSum };
  });
  let leftover = total - parts.reduce((acc, p) => acc + p.floor, 0);
  const ranked = [...parts].sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (const part of ranked) {
    if (leftover === 0) break;
    part.floor += 1;
    leftover -= 1;
  }
  return Object.fromEntries(parts.map((p) => [p.slice, p.floor])) as Record<Slice, number>;
}

export function planAmounts(input: AmountInput): AmountPlan {
  const { lump, monthly, monthlyExpenses, existingReserve, incomeOptionId, level } = input;
  assertWholeMoney("lump", lump);
  assertWholeMoney("monthly", monthly);
  assertWholeMoney("monthlyExpenses", monthlyExpenses);
  assertWholeMoney("existingReserve", existingReserve);

  const reserveTarget = monthlyExpenses * reserveMonthsFor(incomeOptionId);
  const reserveGap = Math.max(0, reserveTarget - existingReserve);
  const toReserve = Math.min(lump, reserveGap);
  const investable = lump - toReserve;
  const remainingGap = reserveGap - toReserve;

  let monthsToFillReserve: number | null = 0;
  if (remainingGap > 0)
    monthsToFillReserve = monthly > 0 ? Math.ceil(remainingGap / monthly) : null;

  const weights = { ...ALLOCATION_TABLE[level] };
  return {
    reserveTarget,
    reserveGap,
    reserveOnly: reserveGap > 0 && investable === 0,
    investable,
    slices: splitByLargestRemainder(investable, weights),
    weights,
    // The staged money is what is left after the reserve, so the rhythm rule sees that amount;
    // with nothing to stage there is a single (empty) tranche.
    trancheMonths: investable === 0 ? 1 : trancheMonthsFor(level, investable, monthly),
    monthsToFillReserve,
  };
}
