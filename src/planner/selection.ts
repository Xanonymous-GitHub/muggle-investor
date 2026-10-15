// Data-driven instrument eligibility and primary selection (spec 「標的清單（用資料決定）」).
// Pure: callers load price stats and the ETF universe, this module only decides.
import type { EtfUniverseRow } from "@/db/repositories/etf-universe";
import type { PriceStats } from "@/db/repositories/prices";
import { daysBetween } from "./metrics";
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
const YEAR_DAYS = 365.25;

/** Ordinal string order (code units), independent of locale. */
const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Excluded by name (leveraged, inverse, futures, currency, commodity) or by symbol suffix. */
const excludedName = (name: string) => ELIGIBILITY.excludedNamePattern.test(name);
const excludedSymbol = (symbol: string) => ELIGIBILITY.excludedSymbolPattern.test(symbol);

/** Median of the recent daily turnovers; 0 when there are none. */
export function medianTurnover(stats: PriceStats): number {
  const sorted = [...stats.recentTurnovers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Reasons the candidate fails the category's eligibility rules; `[]` means eligible. History is
 * measured to `asOf`; staleness to `marketLast`, the newest bar among the candidates, so a
 * market-wide break (Lunar New Year) does not make every member stale. Comparisons are written
 * so a NaN (malformed date) fails the rule.
 */
export function isEligible(
  category: Category,
  candidate: Candidate,
  asOf: string,
  marketLast: string = asOf,
): string[] {
  const { stats } = candidate;
  const reasons: string[] = [];
  if (!(daysBetween(stats.lastDate, marketLast) <= ELIGIBILITY.maxStaleDays)) reasons.push("stale");
  if (!(daysBetween(stats.firstDate, asOf) / YEAR_DAYS >= ELIGIBILITY.minHistoryYears[category])) {
    reasons.push("short_history");
  }
  if (!(medianTurnover(stats) >= ELIGIBILITY.minMedianTurnover)) reasons.push("low_turnover");
  if (excludedName(candidate.name)) reasons.push("excluded_name");
  if (excludedSymbol(candidate.symbol)) reasons.push("excluded_symbol");
  return reasons;
}

/** Longest history first, then higher median turnover, then symbol. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    compareStrings(a.stats.firstDate, b.stats.firstDate) ||
    medianTurnover(b.stats) - medianTurnover(a.stats) ||
    compareStrings(a.symbol, b.symbol)
  );
}

function selectCategory(
  category: Category,
  candidates: readonly Candidate[],
  asOf: string,
  marketLast: string,
): CategorySelection {
  const members = new Set(CATEGORY_MEMBERS[category]);
  const eligible: Candidate[] = [];
  const rejected: CategorySelection["rejected"] = [];
  for (const candidate of candidates) {
    if (!members.has(candidate.symbol)) continue;
    const reasons = isEligible(category, candidate, asOf, marketLast);
    if (reasons.length === 0) eligible.push(candidate);
    else rejected.push({ symbol: candidate.symbol, reasons });
  }
  eligible.sort(compareCandidates);
  rejected.sort((a, b) => compareStrings(a.symbol, b.symbol));
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
  // The newest valid bar on or before asOf; asOf itself when there is none.
  const marketLast = candidates
    .map((candidate) => candidate.stats.lastDate)
    .filter((date) => Number.isFinite(Date.parse(date)) && date <= asOf)
    .reduce((newest, date) => (date > newest ? date : newest), "");
  const last = marketLast || asOf;
  return {
    core: selectCategory("core", candidates, asOf, last),
    bond: selectCategory("bond", candidates, asOf, last),
    dividend: selectCategory("dividend", candidates, asOf, last),
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
 * ETFs that are in no category list and not excluded by name or symbol, with a name-based guess of their
 * category. Feeds the "please confirm" report; nothing here is ever added automatically.
 */
export function discoverCandidates(
  universe: readonly EtfUniverseRow[],
): { symbol: string; name: string; hint: Category | null }[] {
  const known = new Set(CATEGORIES.flatMap((category) => CATEGORY_MEMBERS[category]));
  return universe
    .filter(
      (row) => !known.has(row.symbol) && !excludedName(row.name) && !excludedSymbol(row.symbol),
    )
    .map((row) => ({ symbol: row.symbol, name: row.name, hint: hintFor(row) }));
}
