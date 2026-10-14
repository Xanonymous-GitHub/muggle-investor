// Signed-off allocation table and emergency reserve months (spec 「配置」).
import type { RiskLevel } from "./questionnaire";

export type Slice = "core" | "bond" | "dividend" | "satellite" | "cash";

/** Percent of investable money per slice; every row sums to 100. */
export const ALLOCATION_TABLE: Record<RiskLevel, Record<Slice, number>> = {
  1: { core: 15, bond: 55, dividend: 15, satellite: 0, cash: 15 },
  2: { core: 30, bond: 40, dividend: 20, satellite: 0, cash: 10 },
  3: { core: 45, bond: 25, dividend: 20, satellite: 5, cash: 5 },
  4: { core: 60, bond: 10, dividend: 20, satellite: 10, cash: 0 },
  5: { core: 70, bond: 0, dividend: 15, satellite: 15, cash: 0 },
};

const RESERVE_MONTHS: Record<string, 3 | 6 | 9> = {
  "income-stable": 3,
  "income-fluctuating": 6,
  "income-unstable": 9,
};

export function reserveMonthsFor(incomeOptionId: string): 3 | 6 | 9 {
  const months = RESERVE_MONTHS[incomeOptionId];
  if (months === undefined) {
    throw new Error(`Unknown income option "${incomeOptionId}"`);
  }
  return months;
}
