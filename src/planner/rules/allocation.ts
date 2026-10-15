// Signed-off allocation table and emergency reserve months (spec 「配置」).
import { type RiskLevel, scoreOf } from "./questionnaire";

export type Slice = "core" | "bond" | "dividend" | "satellite" | "cash";

/** Percent of investable money per slice; every row sums to 100. */
export const ALLOCATION_TABLE: Record<RiskLevel, Record<Slice, number>> = {
  1: { core: 15, bond: 55, dividend: 15, satellite: 0, cash: 15 },
  2: { core: 30, bond: 40, dividend: 20, satellite: 0, cash: 10 },
  3: { core: 45, bond: 25, dividend: 20, satellite: 5, cash: 5 },
  4: { core: 60, bond: 10, dividend: 20, satellite: 10, cash: 0 },
  5: { core: 70, bond: 0, dividend: 15, satellite: 15, cash: 0 },
};

/**
 * Emergency-reserve months by income stability: stable 3, fluctuating 6, unstable 9. Read from
 * the income option's questionnaire score (5, 3, 1), so the option ids live in one place; an
 * unknown id (including prototype keys) throws.
 */
export function reserveMonthsFor(incomeOptionId: string): 3 | 6 | 9 {
  const score = scoreOf("income", incomeOptionId);
  if (score === 5) return 3;
  if (score === 3) return 6;
  if (score === 1) return 9;
  throw new Error(`No reserve months for income option "${incomeOptionId}" (score ${score})`);
}
