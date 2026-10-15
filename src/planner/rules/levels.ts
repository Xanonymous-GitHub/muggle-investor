import type { RiskLevel } from "./questionnaire";

/** Spec 「風險輪廓」: the five level names. */
export const LEVEL_NAMES: Record<RiskLevel, string> = {
  1: "保守",
  2: "穩健",
  3: "平衡",
  4: "積極",
  5: "進取",
};
