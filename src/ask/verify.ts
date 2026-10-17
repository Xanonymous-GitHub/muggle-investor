/**
 * Best-effort verification of the numbers in a model answer. Pure: no server, db or env imports.
 *
 * The verifier is advisory. It cannot prove an answer right; it flags figures that appear in the
 * text but neither match a grounded number (from the profile or a tool result) nor follow from
 * two of them in the one way a model would plausibly derive them (see `findUnsupportedNumbers`).
 *
 * Grounding is grouped: one group for request context (passed first), then one group per tool
 * result (`groundedSink.push(collectNumbers(result))`).
 */
import { extractNumberTokens, type NumberToken } from "./numbers";

/** The numbers in `text`; dates and clock times are not numbers. `limit` stops after that many. */
export function extractNumbers(text: string, limit?: number): number[] {
  return extractNumberTokens(text, { skipDates: true, limit }).map((t) => t.value);
}

const MAX_DEPTH = 64;
// A tool result can be huge; grounding needs the first few thousand numbers, not a million.
const MAX_COLLECTED = 5000;

/**
 * Every finite number inside a JSON value, in document order, at most MAX_COLLECTED; strings
 * contribute the numbers written in them.
 */
export function collectNumbers(value: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > MAX_DEPTH || out.length >= MAX_COLLECTED) return;
    if (typeof v === "number") {
      if (Number.isFinite(v)) out.push(v);
    } else if (typeof v === "string") {
      out.push(...extractNumbers(v, MAX_COLLECTED - out.length));
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (out.length >= MAX_COLLECTED) return;
        walk(item, depth + 1);
      }
    } else if (v !== null && typeof v === "object") {
      for (const item of Object.values(v)) {
        if (out.length >= MAX_COLLECTED) return;
        walk(item, depth + 1);
      }
    }
  };
  walk(value, 0);
  return out;
}

const DEFAULT_REL_TOLERANCE = 0.005;
// Derivation is deliberately narrow (R-A4/R-A5): with free combination, a handful of grounded
// values "explains" nearly any figure. The two operands come from one group, sit within this
// magnitude band of each other, and each value pairs with at most this many neighbours.
const BAND = 20;
const MAX_OPERANDS = 40;
const MAX_GROUP_VALUES = 2000;
// Many tool calls make many groups; only the first MAX_GROUPS take part in derivation (direct
// matches still use every group), which bounds the candidate list and the work per answer.
const MAX_GROUPS = 60;
// A percentage derived from small operands (PE, yield, other percent values) is meaningless;
// direct matches still cover those. Only quote-level numbers pair into percent change or ratio.
const MIN_PERCENT_OPERAND = 100;
// Share of the relative tolerance a derived figure gets (0.1% at the default).
const DERIVED_TOLERANCE_SHARE = 0.2;

function isYear(t: NumberToken) {
  return t.bareInteger && t.value >= 1990 && t.value <= 2100;
}

/** A plain small count or an ordinal ("3 個情境", "第 2"); a decimal or percent still gets checked. */
function isSmallCountOrOrdinal(t: NumberToken) {
  return t.bareInteger && (t.value < 10 || t.prev === "第");
}

// A bare integer in front of a classifier is a count or a calendar part whatever its size
// ("共 12 檔", "60 日均線", "115 年", "10 月").
const CLASSIFIER = /^\s?(檔|個|日|天|年|月|季|週|周|名|大|家|支|張|股)/u;

function isCountOrLabel(t: NumberToken) {
  if (!t.bareInteger) return false;
  // "MA20", "Q3": digits glued to a letter label.
  return CLASSIFIER.test(t.after) || /[a-z]/i.test(t.before);
}

/** Lowest index in ascending `sorted` with a value >= `x`. */
function lowerBound(sorted: number[], x: number) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Grounding as groups of finite numbers. Anything that is not a list of lists is tolerated: a
 * non-array is no grounding, a non-array entry is skipped, and bare numbers join one implicit
 * extra group (a caller that passed a flat list still gets sane results).
 */
function normalizeGroups(grounded: unknown): number[][] {
  if (!Array.isArray(grounded)) return [];
  const groups: number[][] = [];
  const bare: number[] = [];
  for (const entry of grounded as unknown[]) {
    if (Array.isArray(entry)) groups.push(entry.filter(isFiniteNumber));
    else if (isFiniteNumber(entry)) bare.push(entry);
  }
  if (bare.length > 0) groups.push(bare);
  return groups;
}

/**
 * Candidates derivable from two numbers of the same group, ascending. `combine` yields the figures
 * a pair (a < b) can explain. A pair qualifies when both are at least `minOperand`, and its members
 * are within the magnitude band of each other, so a 4.6% move on prices near 600 and a 6400-6120
 * gap both qualify; each value pairs with at most MAX_OPERANDS larger neighbours in magnitude
 * order. Pairs never cross groups, only the first MAX_GROUPS groups are used, and a group with
 * more than MAX_GROUP_VALUES distinct values is not derived from at all (it is not a quote-like
 * record; direct matches still work).
 */
function pairCandidates(
  groups: readonly (readonly number[])[],
  combine: (a: number, b: number) => number[],
  minOperand = 0,
) {
  const out: number[] = [];
  for (const group of groups.slice(0, MAX_GROUPS)) {
    const distinct = new Set(group.map(Math.abs));
    if (distinct.size > MAX_GROUP_VALUES) continue;
    const s = [...distinct].filter((x) => x > 0 && x >= minOperand).sort((x, y) => x - y);
    for (let i = 0; i < s.length; i++) {
      const a = s[i] as number;
      for (let j = i + 1; j < s.length && j <= i + MAX_OPERANDS; j++) {
        const b = s[j] as number;
        if (b > BAND * a) break;
        out.push(...combine(a, b));
      }
    }
  }
  return out.sort((x, y) => x - y);
}

// Percent change ((b-a)/a*100, either direction) and ratio (a/b*100, either direction).
const percentOf = (a: number, b: number) => [
  ((b - a) / a) * 100,
  ((b - a) / b) * 100,
  (a / b) * 100,
  (b / a) * 100,
];
const sumAndDifference = (a: number, b: number) => [a + b, b - a];

/**
 * Substrings of `text` whose number is neither within tolerance of a grounded number nor derived
 * from two of them.
 *
 * `grounded` is a list of groups: one for request context (profile numbers and the numbers in
 * every earlier message, the user's and the assistant's), plus one per tool result. Callers keep a
 * `groundedSink: number[][]` and push `collectNumbers(result)` as one group per result; the
 * context group goes FIRST, because derivation only reads the first MAX_GROUPS groups and the
 * profile's figures must never be the ones dropped. A figure is supported
 * when it matches any number in the union of all groups directly. Derivation (R-A4/R-A5) pairs two
 * numbers of the SAME group only: a percentage (a number followed by %) may be the percent change
 * or the ratio of the pair; any other figure may be their sum or difference. A derivation whose
 * operands came from different tool results is flagged: a deliberate soft-flag cost, since
 * crossing groups would let a few hundred values "explain" nearly any figure.
 *
 * Tolerance is the larger of `relTolerance` (default 0.5%) and half a unit of the last digit
 * shown; derived figures get a fifth of the relative part. Counts, ordinals, years, dates and
 * labels are not checked.
 *
 * Sign is ignored throughout: "下跌 3.2%" matches a grounded -3.2, and a reversed direction
 * ("漲" for a grounded fall) is not detected. Deduplicated, in order of first appearance.
 */
export function findUnsupportedNumbers(
  text: string,
  grounded: readonly (readonly number[])[],
  opts: { relTolerance?: number } = {},
): string[] {
  const rel = opts.relTolerance ?? DEFAULT_REL_TOLERANCE;
  const groups = normalizeGroups(grounded);
  const values = [...new Set(groups.flat().map(Math.abs))].sort((x, y) => x - y);
  let percents: number[] | undefined;
  let plains: number[] | undefined;

  const checked = new Set<string>();
  const unsupported = new Set<string>();
  for (const t of extractNumberTokens(text, { skipDates: true })) {
    if (checked.has(t.raw)) continue;
    checked.add(t.raw);
    if (isYear(t) || isSmallCountOrOrdinal(t) || isCountOrLabel(t)) continue;
    const v = Math.abs(t.value);
    const half = 0.5 * 10 ** -t.decimals * t.scale + 1e-9;
    const within = (target: number, r: number) =>
      Math.abs(v - target) <= Math.max(r * Math.abs(target), half);
    const near = (target: number) => within(target, rel);
    // A derived figure is computed exactly from grounded numbers, so only the rounding of what is
    // shown needs room; a wide relative band on top of many candidates accepts anything.
    // A figure shown with decimals states its own precision, so only that rounding is allowed;
    // an integer may be rounded further (trailing zeros), so it keeps a small relative band.
    const nearDerived = (target: number) =>
      within(target, t.decimals > 0 ? 0 : rel * DERIVED_TOLERANCE_SHARE);

    // Direct: any grounded number (or a ratio shown as a percentage), found by binary search.
    const reach = Math.max((rel * v) / (1 - rel), half);
    const anyNear = (sorted: number[], scale: number, ok: (target: number) => boolean) => {
      for (let k = lowerBound(sorted, (v - reach) / scale); k < sorted.length; k++) {
        const c = (sorted[k] as number) * scale;
        if (c > v + reach) return false;
        if (ok(c)) return true;
      }
      return false;
    };
    let supported = anyNear(values, 1, near) || (t.percent && anyNear(values, 100, near));
    if (!supported) {
      let candidates: number[];
      if (t.percent) {
        candidates = percents ??= pairCandidates(groups, percentOf, MIN_PERCENT_OPERAND);
      } else candidates = plains ??= pairCandidates(groups, sumAndDifference);
      supported = anyNear(candidates, 1, nearDerived);
    }
    if (!supported) unsupported.add(t.raw);
  }
  return [...unsupported];
}
