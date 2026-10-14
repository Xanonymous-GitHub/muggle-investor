// Signed-off investing rhythm (spec 「投入節奏」).
import type { RiskLevel } from "./questionnaire";

/** Months to spread the lump sum over; 1 means no staging. */
export function trancheMonthsFor(level: RiskLevel, lump: number, monthly: number): number {
  if (lump < 3 * monthly) return 1;
  return level <= 3 ? 6 : 3;
}
