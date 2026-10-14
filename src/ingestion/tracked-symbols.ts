import { CATEGORY_MEMBERS } from "@/planner/rules/instruments";

/** Symbols whose daily prices and corporate actions ingestion keeps current: every category member, once, in category order. */
export const TRACKED_SYMBOLS: readonly string[] = [
  ...new Set(Object.values(CATEGORY_MEMBERS).flat()),
];
