// Data-driven instrument eligibility and primary selection (spec 「標的清單（用資料決定）」).
// Pure: callers load price stats and the ETF universe, this module only decides.
import type { EtfUniverseRow } from "@/db/repositories/etf-universe";
import type { PriceStats } from "@/db/repositories/prices";
import { CATEGORY_MEMBERS, ELIGIBILITY } from "./rules/instruments";

export type Category = "core" | "bond" | "dividend";

export type Candidate = { symbol: string; name: string; stats: PriceStats };

export type CategorySelection = {
  category: Category;
  primary: Candidate | null;
  alternate: Candidate | null;
  rejected: { symbol: string; reasons: string[] }[];
};

const CATEGORIES = ["core", "bond", "dividend"] as const satisfies readonly Category[];
const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

/** Whole days from `from` to `to` (both YYYY-MM-DD), by UTC midnight. */
const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;

/** Median of the recent daily turnovers; 0 when there are none. */
export function medianTurnover(stats: PriceStats): number {
  const sorted = [...stats.recentTurnovers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Reasons the candidate fails the category's eligibility rules; `[]` means eligible. */
export function isEligible(category: Category, candidate: Candidate, asOf: string): string[] {
  const { stats } = candidate;
  const reasons: string[] = [];
  if (daysBetween(stats.lastDate, asOf) > ELIGIBILITY.maxStaleDays) reasons.push("stale");
  if (daysBetween(stats.firstDate, asOf) / YEAR_DAYS < ELIGIBILITY.minHistoryYears[category]) {
    reasons.push("short_history");
  }
  if (medianTurnover(stats) < ELIGIBILITY.minMedianTurnover) reasons.push("low_turnover");
  if (ELIGIBILITY.excludedNamePattern.test(candidate.name)) reasons.push("excluded_name");
  return reasons;
}

/** Longest history first, then higher median turnover, then symbol. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    a.stats.firstDate.localeCompare(b.stats.firstDate) ||
    medianTurnover(b.stats) - medianTurnover(a.stats) ||
    a.symbol.localeCompare(b.symbol)
  );
}

function selectCategory(
  category: Category,
  candidates: readonly Candidate[],
  asOf: string,
): CategorySelection {
  const members = new Set(CATEGORY_MEMBERS[category]);
  const eligible: Candidate[] = [];
  const rejected: CategorySelection["rejected"] = [];
  for (const candidate of candidates) {
    if (!members.has(candidate.symbol)) continue;
    const reasons = isEligible(category, candidate, asOf);
    if (reasons.length === 0) eligible.push(candidate);
    else rejected.push({ symbol: candidate.symbol, reasons });
  }
  eligible.sort(compareCandidates);
  rejected.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    category,
    primary: eligible[0] ?? null,
    alternate: eligible[1] ?? null,
    rejected,
  };
}

/** Per category: primary = longest-history eligible member, alternate = the next one. */
export function selectInstruments(
  candidates: readonly Candidate[],
  asOf: string,
): Record<Category, CategorySelection> {
  return {
    core: selectCategory("core", candidates, asOf),
    bond: selectCategory("bond", candidates, asOf),
    dividend: selectCategory("dividend", candidates, asOf),
  };
}

const BOND_NAME = /債/;
const BOND_SYMBOL = /B$/;
const DIVIDEND_NAME = /高股息|高息|優息|股息|息收|配息|收益/;
const CORE_NAME = /台灣50|臺灣50|台50|中型100|MSCI台灣|台灣領袖|台灣加權|台灣全市場/;

function hintFor(row: EtfUniverseRow): Category | null {
  if (BOND_NAME.test(row.name) || BOND_SYMBOL.test(row.symbol)) return "bond";
  if (DIVIDEND_NAME.test(row.name)) return "dividend";
  if (CORE_NAME.test(row.name)) return "core";
  return null;
}

/**
 * ETFs that are in no category list and not excluded by name, with a name-based guess of their
 * category. Feeds the "please confirm" report; nothing here is ever added automatically.
 */
export function discoverCandidates(
  universe: readonly EtfUniverseRow[],
): { symbol: string; name: string; hint: Category | null }[] {
  const known = new Set(CATEGORIES.flatMap((category) => CATEGORY_MEMBERS[category]));
  return universe
    .filter((row) => !known.has(row.symbol) && !ELIGIBILITY.excludedNamePattern.test(row.name))
    .map((row) => ({ symbol: row.symbol, name: row.name, hint: hintFor(row) }));
}
