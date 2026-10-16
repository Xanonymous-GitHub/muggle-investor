/**
 * Best-effort verification of the numbers in a model answer. Pure: no server, db or env imports.
 *
 * The verifier is advisory. It cannot prove an answer right; it flags figures that appear in the
 * text but neither match a grounded number (from the profile or a tool result) nor follow from
 * two of them in the one way a model would plausibly derive them (see `findUnsupportedNumbers`).
 *
 * Grounding is grouped. Tasks 5/6/8 keep a `groundedSink: number[][]`: one group per tool result
 * (`groundedSink.push(collectNumbers(result))`) plus one for request context.
 */
import { extractNumberTokens, type NumberToken } from "./numbers";

/** The numbers in `text`; dates and clock times are not numbers. */
export function extractNumbers(text: string): number[] {
  return extractNumberTokens(text, { skipDates: true }).map((t) => t.value);
}

const MAX_DEPTH = 64;

/** Every finite number inside a JSON value; strings contribute the numbers written in them. */
export function collectNumbers(value: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (typeof v === "number") {
      if (Number.isFinite(v)) out.push(v);
    } else if (typeof v === "string") {
      out.push(...extractNumbers(v));
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
    } else if (v !== null && typeof v === "object") {
      for (const item of Object.values(v)) walk(item, depth + 1);
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

/**
 * Candidates derivable from two numbers of the same group, ascending. `combine` yields the figures
 * a pair (a < b) can explain. A pair qualifies when its members are within the magnitude band of
 * each other, so a 4.6% move on prices near 600 and a 6400-6120 gap both qualify; each value pairs
 * with at most MAX_OPERANDS larger neighbours in magnitude order. Pairs never cross groups.
 */
function pairCandidates(
  groups: readonly (readonly number[])[],
  combine: (a: number, b: number) => number[],
) {
  const out: number[] = [];
  for (const group of groups) {
    const s = [...new Set(group.filter(Number.isFinite).map(Math.abs))]
      .filter((x) => x > 0)
      .sort((x, y) => x - y);
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
 * `grounded` is a list of groups: one per tool result, plus one for request context (profile
 * numbers, numbers the user typed, earlier-turn numbers). Callers keep a `groundedSink: number[][]`
 * and push `collectNumbers(result)` as one group per result (Tasks 5/6/8). A figure is supported
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
  const values = [...new Set(grounded.flat().filter(Number.isFinite).map(Math.abs))];
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
    const nearDerived = (target: number) => within(target, rel * DERIVED_TOLERANCE_SHARE);

    let supported = values.some((g) => near(g) || (t.percent && near(g * 100)));
    if (!supported) {
      let candidates: number[];
      if (t.percent) candidates = percents ??= pairCandidates(grounded, percentOf);
      else candidates = plains ??= pairCandidates(grounded, sumAndDifference);
      const reach = Math.max((rel * v) / (1 - rel), half);
      for (let k = lowerBound(candidates, v - reach); !supported && k < candidates.length; k++) {
        const c = candidates[k] as number;
        if (c > v + reach) break;
        supported = nearDerived(c);
      }
    }
    if (!supported) unsupported.add(t.raw);
  }
  return [...unsupported];
}
