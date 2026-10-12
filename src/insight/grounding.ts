import type { FactSheet } from "./facts";

/**
 * Validators for LLM-written briefings. `checkGrounding` rejects any number the fact sheet does
 * not support; `findForbiddenPredictions` rejects statements about tomorrow's direction. Both are
 * pure and deterministic.
 */

/**
 * Integers from 0 to this value are allowed without appearing in the facts, because prose needs
 * ranks and counts ("前 3 大族群") that the fact sheet does not list. The allowance covers only
 * plain integers: a percentage ("5%") or a number written with decimals ("3.0") must be grounded
 * in the facts like any other number.
 */
export const SMALL_INTEGER_MAX = 20;

/** Largest gap, in characters, between a future-time word and a direction word that is flagged. */
export const PREDICTION_WINDOW = 30;

/**
 * Slack, in units of the candidate's last written decimal place, absorbed when deciding whether
 * a candidate is a rounding of a fact. In binary floating point the written tie 1.005 scales to
 * 100.49999999999999; the slack keeps both neighbours (1.00 and 1.01) acceptable.
 */
const ROUNDING_EPSILON = 1e-6;

export type Numeral = {
  /** Signed value as written, thousands separators removed. */
  value: number;
  /** Digits written after the decimal point ("10,465.0" → 1). */
  decimals: number;
  /** Followed by a percent sign, optionally after whitespace. */
  percent: boolean;
};

/**
 * One numeral token. The integer part is either comma-grouped (a 1–3 digit head followed by one or
 * more ",ddd" groups, not followed by another digit) or a plain digit run; an optional fraction
 * follows. A match always starts at the first digit of a run, because the plain-run alternative
 * consumes whole runs.
 */
const NUMERAL = /(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.(\d+))?/g;
const PERCENT_AFTER = /\s*%/y;
const SIGN_CHARS = new Set(["+", "-", "−"]);
const DIGIT = /\d/;
const DECIMAL_DIGIT = /\p{Nd}/u;
/** A Unicode decimal digit (general category Nd) other than ASCII 0–9. */
const NON_ASCII_DIGIT = /[^\P{Nd}0-9]/gu;

/**
 * ASCII form of a Unicode decimal digit. Unicode encodes every set of decimal digits as a
 * contiguous ascending run 0–9, so a digit's value is its distance from the start of its run. The
 * modulo guards runs of several adjacent sets (mathematical, segmented and outlined digits), which
 * NFKC already folds to ASCII before this runs.
 */
function toAsciiDigit(digit: string): string {
  const codePoint = digit.codePointAt(0) ?? 0;
  let offset = 0;
  while (DECIMAL_DIGIT.test(String.fromCodePoint(codePoint - offset - 1))) offset += 1;
  return String(offset % 10);
}

/**
 * Rewrites every digit form as ASCII so none can slip past the scan:
 * - Unicode NFKC turns full-width digits (１．２４％), circled digits (①) and other compatibility
 *   forms into ASCII. The full-width and small commas are left as they are: NFKC would turn them
 *   into ASCII commas and "120，530" into the number 120530.
 * - Decimal digits of other scripts (Arabic-Indic ٥, Devanagari ५, …) become ASCII digits, and the
 *   Arabic decimal and thousands separators (٫ ٬) become "." and ",".
 */
function normalize(text: string): string {
  return text
    .replace(/[^，﹐]+/g, (run) => run.normalize("NFKC"))
    .replace(NON_ASCII_DIGIT, toAsciiDigit)
    .replaceAll("٫", ".")
    .replaceAll("٬", ",");
}

/**
 * Scans `text` for numerals as they appear in Traditional-Chinese financial prose, after
 * `normalize` has rewritten every Unicode decimal digit as ASCII.
 *
 * - Digits with an optional fraction: "0.63", "49349".
 * - Thousands separators: an ASCII comma followed by exactly three digits ("10,465.0" → 10465).
 *   "12,3456" and "12,34" are two numbers each. The full-width comma is never a separator.
 * - Sign: "+", "-" or "−" directly before the first digit, unless the character before the sign is
 *   a digit. So "-0.63%" → -0.63, but the hyphens in the date "2026-10-08" and in "1-2" are
 *   separators. A sign followed by a space ("- 3", a list bullet) is not a sign.
 * - Unit suffixes (%, 億, 點, 檔, 家, 倍, …) are not part of the value. A trailing % is recorded
 *   only so small-integer percentages can be told apart from counts.
 * - Anything else splits numbers: a clock time "09:28" → 9 and 28, a date → year, month, day.
 *
 * Known limitations, by design:
 * - Chinese numerals (一、二、三個、三成, 百分之五) are skipped entirely, so a number the LLM
 *   writes that way is not checked.
 * - Unit scaling is ignored (4.9 萬 is 4.9, not 49000), as are scientific notation ("1e5" → 1 and
 *   5) and decimals without a leading digit (".5" → 5). These are still checked, as the digit runs
 *   they contain, which errs towards rejection.
 */
export function extractNumerals(text: string): Numeral[] {
  const source = normalize(text);
  const numerals: Numeral[] = [];
  for (const match of source.matchAll(NUMERAL)) {
    const [token, integer = "", fraction] = match;
    const start = match.index;
    const before = source[start - 1];
    const signed =
      before !== undefined && SIGN_CHARS.has(before) && !DIGIT.test(source[start - 2] ?? "");
    const magnitude = Number(`${integer.replaceAll(",", "")}${fraction ? `.${fraction}` : ""}`);
    const value = signed && before !== "+" && magnitude !== 0 ? -magnitude : magnitude;
    PERCENT_AFTER.lastIndex = start + token.length;
    numerals.push({
      value,
      decimals: fraction?.length ?? 0,
      percent: PERCENT_AFTER.test(source),
    });
  }
  return numerals;
}

/** Every numeral's value in `text`, in order (see `extractNumerals` for exactly what counts). */
export function extractNumbers(text: string): number[] {
  return extractNumerals(text).map((numeral) => numeral.value);
}

/** True if `fact`, rounded to `numeral`'s written decimal places, gives `numeral`'s magnitude. */
function isRoundingOf(numeral: Numeral, fact: number): boolean {
  const scale = 10 ** numeral.decimals;
  const units = Math.round(Math.abs(numeral.value) * scale);
  return Math.abs(Math.abs(fact) * scale - units) <= 0.5 + ROUNDING_EPSILON;
}

function isGrounded(numeral: Numeral, facts: FactSheet): boolean {
  const magnitude = Math.abs(numeral.value);
  if (facts.numbers.has(magnitude) || facts.numbers.has(numeral.value)) return true;
  if (
    numeral.decimals === 0 &&
    !numeral.percent &&
    Number.isInteger(magnitude) &&
    magnitude <= SMALL_INTEGER_MAX
  ) {
    return true;
  }
  for (const fact of facts.numbers) {
    // A fact with no recorded precision grounds only exact matches (handled above).
    const precision = facts.precisions.get(Math.abs(fact)) ?? Number.POSITIVE_INFINITY;
    if (numeral.decimals >= precision - 1 && isRoundingOf(numeral, fact)) return true;
  }
  return false;
}

/**
 * Checks that every numeral in `output` is supported by `facts`. A numeral is grounded when:
 *
 * 1. its absolute value equals a fact's absolute value (so "下跌 1.24%" is grounded by -1.24 —
 *    the sign is not checked, because prose carries direction in words);
 * 2. it is a fact rounded to the numeral's own written decimal places, dropping at most ONE of
 *    the decimal places the fact is written with in the fact text (`FactSheet.precisions`):
 *    1.24 → "1.2" but not "1"; 1034.4 → "1034"; 60.06 → "60.1" but not "60". A fact written as an
 *    integer therefore matches only exactly. A numeral written with at least as many decimals as
 *    the fact must equal it (1.24 → "1.240", not "1.20"). At an exact tie either neighbour is
 *    accepted, so the result does not depend on the rounding mode or on binary floating point.
 *    Allowing only one dropped place keeps integers from matching any of the ~100 facts within
 *    ±0.5 ("104 億" is not a rounding of 104.13);
 * 3. it is a plain integer from 0 to `SMALL_INTEGER_MAX` (ranks and counts); or
 * 4. it is a component of a date or time in the facts. `FactSheet.numbers` already contains every
 *    numeral in the fact text — including the components of each date and time — plus the trade
 *    date's digits, so rule 4 is satisfied by rule 1.
 *
 * `ungrounded` lists the offending values as written (signed), once each, in order of appearance.
 */
export function checkGrounding(
  output: string,
  facts: FactSheet,
): { ok: boolean; ungrounded: number[] } {
  const ungrounded = new Set<number>();
  for (const numeral of extractNumerals(output)) {
    if (!isGrounded(numeral, facts)) ungrounded.add(numeral.value);
  }
  return { ok: ungrounded.size === 0, ungrounded: [...ungrounded] };
}

const FUTURE_WORDS = ["明天", "明日", "隔天", "下週", "下周", "下個交易日", "未來"];
const DIRECTION_WORDS = [
  "上漲",
  "下跌",
  "大漲",
  "大跌",
  "看漲",
  "看跌",
  "會漲",
  "會跌",
  "將漲",
  "將跌",
  "反彈",
  "回檔",
  "續漲",
  "續跌",
  "預期",
  "預測",
  "可望",
];
const GUARANTEE_WORDS = ["保證", "穩賺", "必漲", "必跌", "一定會漲", "一定會跌"];
/**
 * Direction words that are also the fact sheet's own labels when followed by 族群
 * (上漲族群／下跌族群 are today's group counts, not a direction claim).
 */
const LABEL_WORDS = new Set(["上漲", "下跌"]);

/**
 * A future-time word and a direction word, in either order, with at most `PREDICTION_WINDOW`
 * characters (code points, punctuation and line breaks included) between them; or a guarantee
 * word. The gap is a bounded lazy `[\s\S]{0,30}?` with no nested quantifier, so a scan costs at
 * most a constant amount of work per input position: no catastrophic backtracking.
 *
 * 上漲 and 下跌 do not count as direction words when directly followed by 族群.
 *
 * The words are plain CJK literals with no regex metacharacters, so they are joined unescaped.
 */
const FORBIDDEN = (() => {
  const future = `(?:${FUTURE_WORDS.join("|")})`;
  const directionWords = DIRECTION_WORDS.map((word) =>
    LABEL_WORDS.has(word) ? `${word}(?!族群)` : word,
  );
  const direction = `(?:${directionWords.join("|")})`;
  const gap = `[\\s\\S]{0,${PREDICTION_WINDOW}}?`;
  return new RegExp(
    `${future}${gap}${direction}|${direction}${gap}${future}|${GUARANTEE_WORDS.join("|")}`,
    "gu",
  );
})();

/**
 * Returns the snippets of `text` that predict a future direction ("明天大盤可能上漲",
 * "預期明日") or promise a result ("穩賺"), in order of appearance; empty when there are none.
 * Statements about today ("今天資金淨流出"), a future date without a direction ("明天是週五") and
 * the group-count labels 上漲族群／下跌族群 pass. Negated statements ("不代表明天會上漲", "不保證獲利") are flagged too: the check is
 * deliberately conservative, so briefings must phrase disclaimers without these words.
 */
export function findForbiddenPredictions(text: string): string[] {
  return Array.from(text.matchAll(FORBIDDEN), (match) => match[0]);
}
