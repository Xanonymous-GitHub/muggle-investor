/**
 * Privacy filter for arguments headed to external tools (search, MCP). Pure: no server, db or env
 * imports.
 *
 * Private numbers below 1000 are ignored (ruling R-A1): small amounts and quantities collide with
 * ordinary arguments such as `limit` or `count`, so only a private number >= 1000 can block. A
 * number counts as leaked when a human could read it out of the arguments: plain, comma-grouped,
 * 萬/億 (optional space), ASCII w/m/k units, full-width digits (NFKC); matched by equality after
 * unit expansion. Sign is ignored.
 */
import { extractNumberTokens } from "./verify";

export const leakMessage = "這個查詢含有你的私人金額，已被攔下；請改用不含金額的查詢。";

const MIN_PRIVATE_NUMBER = 1000;
const MAX_DEPTH = 64;

export function argsLeakPrivateData(args: unknown, privateNumbers: number[]): boolean {
  const privates = new Set(
    privateNumbers
      .filter((n) => Number.isFinite(n) && Math.abs(n) >= MIN_PRIVATE_NUMBER)
      .map(Math.abs),
  );
  if (privates.size === 0) return false;

  const leaks = (v: unknown, depth: number): boolean => {
    // Tool arguments are parsed JSON, so this is never legitimate; refuse rather than skip.
    if (depth > MAX_DEPTH) return true;
    if (typeof v === "number") return privates.has(Math.abs(v));
    if (typeof v === "string")
      return extractNumberTokens(v).some((t) => privates.has(Math.abs(t.value)));
    if (Array.isArray(v)) return v.some((item) => leaks(item, depth + 1));
    if (v !== null && typeof v === "object") {
      return Object.entries(v).some(
        ([key, item]) => leaks(key, depth + 1) || leaks(item, depth + 1),
      );
    }
    return false;
  };
  return leaks(args, 0);
}
