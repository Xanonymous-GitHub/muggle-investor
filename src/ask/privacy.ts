/**
 * Privacy filter for arguments headed to external tools (search, MCP). Pure: no server, db or env
 * imports. Best-effort: it blocks what a human would read as a private amount, not every
 * conceivable encoding.
 *
 * Private numbers below 1000 are ignored (ruling R-A1): small amounts and quantities collide with
 * ordinary arguments such as `limit` or `count`, so only a private number >= 1000 can block. A
 * number counts as leaked when it can be read out of the arguments by equality after unit
 * expansion (sign ignored): plain; comma-grouped (also Indian 15,00,000); grouped by spaces
 * (NBSP/thin spaces fold to one), dots, apostrophes, underscores or hyphens (a leading 1-3 digits
 * and at least two groups of exactly three: 1.500.000, 1-500-000; "1.500" and dates such as
 * 2026-10-14 are not amounts); four-digit 萬 grouping and loose splits (150,0000, 1500 000,
 * 15 00 000); zero-width characters inside a number (stripped first); 萬/億/千/百萬 and
 * million(s)/mil/mio/mn/MM/thousand/w/m/k units, spaced or not (1.5 M, 30 k, 1,5 Mio); exponents
 * (1.5e6); Chinese numerals including formal and digit-by-digit ones (一百五十萬, 壹佰伍拾萬,
 * 一五〇萬, 三十千); full-width digits (NFKC).
 *
 * Known gaps, not implemented: spelled-out English ("one point five million"), "1.5x10^6" /
 * "1.5×10^6", hexadecimal, and any other free-form encoding (the model could also split a number
 * across two arguments). Also not caught (checked): lakh/crore (15 lakh, 1.5 crore), Millionen/
 * mln/mill, slang such as "30 grand", mixed numerals such as 1百50萬, a single group after an
 * apostrophe or dot (30'000, 30.000: one group of three is not told apart from a decimal such as
 * 1.500), and five-digit loose groupings (3,0000 and 3 0000). A lowercase "1.5 mm" is
 * deliberately not million (millimetres); uppercase "MM" is.
 */
import { readableValues } from "./numbers";

export const leakMessage =
  "這個查詢含有你的私人資料，已被攔下；請改用只含公開代號或主題的查詢，不要放金額、個人狀況或你說過的私事。";

const MIN_PRIVATE_NUMBER = 1000;
const MAX_DEPTH = 64;

export type LeakOptions = {
  /** Private numbers below this are ignored (default 1000, ruling R-A1). */
  min?: number;
  /**
   * Argument names whose plain number values are paging controls (`limit`, `count`, ...): a number
   * under one of them is never read as an amount. Text values under them are still scanned.
   */
  exemptKeys?: ReadonlySet<string>;
};

export function argsLeakPrivateData(
  args: unknown,
  privateNumbers: readonly number[],
  { min = MIN_PRIVATE_NUMBER, exemptKeys }: LeakOptions = {},
): boolean {
  const privates = new Set(
    privateNumbers.filter((n) => Number.isFinite(n) && Math.abs(n) >= min).map(Math.abs),
  );
  if (privates.size === 0) return false;

  const leaks = (v: unknown, depth: number): boolean => {
    // Tool arguments are parsed JSON, so this is never legitimate; refuse rather than skip.
    if (depth > MAX_DEPTH) return true;
    if (typeof v === "number") return privates.has(Math.abs(v));
    if (typeof v === "string") return [...readableValues(v)].some((n) => privates.has(n));
    if (Array.isArray(v)) return v.some((item) => leaks(item, depth + 1));
    if (v !== null && typeof v === "object") {
      return Object.entries(v).some(
        ([key, item]) =>
          leaks(key, depth + 1) ||
          (typeof item === "number" && exemptKeys?.has(key.toLowerCase())
            ? false
            : leaks(item, depth + 1)),
      );
    }
    return false;
  };
  return leaks(args, 0);
}
