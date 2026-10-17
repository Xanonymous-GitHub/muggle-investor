/**
 * Number parsing shared by `verify.ts` (which numbers does an answer state?) and `privacy.ts`
 * (which numbers could a human read out of a tool argument?). Pure: no server, db or env imports.
 *
 * Two entry points:
 * - `extractNumberTokens`: positioned tokens with the facts the verifier needs (percent, shown
 *   precision, what follows). Dates and clock times can be masked out.
 * - `readableValues`: the privacy view. A superset of interpretations (space-grouped digits,
 *   Chinese numerals), because there a missed reading leaks an amount while an extra one only
 *   matters on exact equality with a private number.
 */

export interface NumberToken {
  /** The substring as the author wrote it (before NFKC folding). */
  raw: string;
  /** Signed value after unit expansion (150萬 -> 1_500_000); a percent sign leaves the value as shown. */
  value: number;
  /** Digits after the decimal point as shown. */
  decimals: number;
  /** Multiplier of the unit/exponent (1 when none); with `decimals` it fixes the shown precision. */
  scale: number;
  percent: boolean;
  /** True when the token carries a unit such as 萬/億/million/w/m/k. */
  hasUnit: boolean;
  /** True when the token is bare digits: no sign, separator, decimal, unit, exponent or percent. */
  bareInteger: boolean;
  /** The character immediately before the token (folded text), or "". */
  before: string;
  /** The last non-space character before the token, or "". */
  prev: string;
  /** Up to four characters right after the token (folded text). */
  after: string;
}

const UNIT_SCALE: Record<string, number> = {
  千: 1e3,
  thousand: 1e3,
  thousands: 1e3,
  k: 1e3,
  萬: 1e4,
  万: 1e4,
  w: 1e4,
  百萬: 1e6,
  百万: 1e6,
  million: 1e6,
  millions: 1e6,
  mil: 1e6,
  mio: 1e6,
  mn: 1e6,
  mm: 1e6,
  m: 1e6,
  千萬: 1e7,
  千万: 1e7,
  億: 1e8,
  亿: 1e8,
  billion: 1e9,
  billions: 1e9,
  bn: 1e9,
  百億: 1e10,
  百亿: 1e10,
  千億: 1e11,
  千亿: 1e11,
};

const ci = (word: string) => [...word].map((c) => `[${c}${c.toUpperCase()}]`).join("");
// English unit words; "MM" is million only in capitals ("1.5mm" is millimetres).
const WORD_UNITS = ["millions?", "mil", "mio", "mn", "billions?", "bn", "thousands?"]
  .map((w) => (w.endsWith("?") ? `${ci(w.slice(0, -2))}(?:[sS])?` : ci(w)))
  .join("|");
const CJK_UNITS = "百萬|百万|千萬|千万|百億|百亿|千億|千亿|億|亿|萬|万|千";
// A "k" before 線/棒 is a chart term (60 K線), never a thousand.
const NOT_LETTER = "(?![A-Za-z線棒])";

// Not preceded by a digit or the fraction part of another number. The integer part is plain,
// comma-grouped (1,500,000) or Indian-grouped (15,00,000; the repeat is capped so a long run of
// short groups cannot backtrack quadratically); a leading-dot form (.5) is allowed; an exponent
// (1.5e6) and one unit or a percent sign may follow.
//
// Strict (answers): single-letter units (w/m/k) and MM must be glued to the digits, so "5 M 平均"
// or "持有 3 m" are not amounts; spaced English words ("1.5 million") and CJK units still count.
// Lenient (privacy): every ASCII unit may follow a little space ("1.5 M", "30 k").
const numberPattern = (lenient: boolean) =>
  new RegExp(
    String.raw`(?<!\d|\d\.)([-−])?(?:(\d{1,3}(?:,\d{3})+(?!\d)|\d{1,2}(?:,\d{2}){1,6},\d{3}(?!\d)|\d+)(?:\.(\d+))?|\.(\d+))` +
      String.raw`(?:[eE]([+-]?\d{1,4})(?![A-Za-z]))?` +
      String.raw`(?:\s{0,2}(?<cjk>${CJK_UNITS})|` +
      (lenient
        ? String.raw`\s{0,2}(?<w>${WORD_UNITS}|MM|[wWmMkK])${NOT_LETTER}|`
        : String.raw`\s{0,2}(?<w>${WORD_UNITS})(?![A-Za-z])|(?<l>MM|[wWmMkK])${NOT_LETTER}|`) +
      "(?<pct>%))?",
    "gu",
  );
const STRICT_NUMBER = numberPattern(false);
const LENIENT_NUMBER = numberPattern(true);
// 1億5000萬: the 萬 part after a 億 token; 1萬5000: the digits right after a 萬 token.
const WAN_TAIL = /\s?(\d+(?:\.\d+)?)\s?(?:萬|万)/uy;
const DIGIT_TAIL = /(\d{1,4})(?![\d.,])/uy;

const DATE_PATTERNS = [
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/gu,
  /\d{1,2}[-/]\d{1,2}[-/]\d{4}/gu,
  /(?<![\d./])\d{1,2}\/\d{1,2}(?![\d/])/gu,
  /\d{4}\s?年\s?\d{1,2}\s?月(?:\s?\d{1,2}\s?[日號号])?/gu,
  /\d{1,2}\s?月(?:\s?\d{1,2}\s?[日號号]|\d{1,2}(?![\d.]))?/gu,
  /\d{1,2}:\d{2}(?::\d{2})?/gu,
];

/** NFKC-fold each code point on its own so folded indexes map back to the original text. */
function fold(text: string): { folded: string; start: number[]; end: number[] } {
  let folded = "";
  const start: number[] = [];
  const end: number[] = [];
  let at = 0;
  for (const cp of text) {
    const norm = cp.normalize("NFKC");
    for (let i = 0; i < norm.length; i++) {
      start.push(at);
      end.push(at + cp.length);
    }
    folded += norm;
    at += cp.length;
  }
  return { folded, start, end };
}

const blank = (s: string) => " ".repeat(s.length);

interface FoldedToken extends Omit<NumberToken, "raw"> {
  from: number;
  to: number;
}

function tokenizeFolded(folded: string, lenient: boolean, limit = Number.POSITIVE_INFINITY) {
  const tokens: FoldedToken[] = [];
  for (const m of folded.matchAll(lenient ? LENIENT_NUMBER : STRICT_NUMBER)) {
    if (tokens.length >= limit) break;
    const [matched, sign, int, frac, frac2, exponent] = m;
    const { cjk: cjkUnit, w, l, pct } = m.groups as Record<string, string | undefined>;
    const from = m.index;
    let to = from + matched.length;
    const unit = cjkUnit ?? w ?? l;
    const fraction = frac ?? frac2;
    let scale = (unit ? (UNIT_SCALE[unit.toLowerCase()] ?? 1) : 1) * 10 ** Number(exponent ?? 0);
    let decimals = fraction?.length ?? 0;
    let value =
      Number(`${(int ?? "0").replaceAll(",", "")}${fraction ? `.${fraction}` : ""}`) * scale;
    if (cjkUnit === "億" || cjkUnit === "亿") {
      WAN_TAIL.lastIndex = to;
      const tail = WAN_TAIL.exec(folded);
      if (tail?.[1]) {
        value += Number(tail[1]) * 1e4;
        scale = 1e4;
        decimals = tail[1].split(".")[1]?.length ?? 0;
        to += tail[0].length;
      }
    } else if (cjkUnit === "萬" || cjkUnit === "万") {
      DIGIT_TAIL.lastIndex = to;
      const tail = DIGIT_TAIL.exec(folded);
      if (tail?.[1]) {
        value += Number(tail[1]);
        scale = 1;
        decimals = 0;
        to += tail[0].length;
      }
    }
    if (!Number.isFinite(value)) continue;
    // Round away binary noise such as 1.15 * 1e4.
    value = Number(value.toPrecision(12));
    let k = from - 1;
    while (k >= 0 && folded[k] === " " && from - k <= 4) k--;
    tokens.push({
      value: sign ? -value : value,
      decimals,
      scale,
      percent: pct !== undefined,
      hasUnit: unit !== undefined,
      bareInteger:
        !sign && int !== undefined && !/[,.]/.test(int) && !fraction && !exponent && !unit && !pct,
      before: folded[from - 1] ?? "",
      prev: k >= 0 ? (folded[k] ?? "") : "",
      after: folded.slice(to, to + 4),
      from,
      to,
    });
  }
  return tokens;
}

/**
 * Every number a human would read in `text` (strict reading, for answers): plain, comma-grouped,
 * 萬/億/million units, glued w/m/k, a trailing percent sign, full-width digits. With `skipDates`,
 * dates and clock times are not numbers; `limit` stops after that many tokens.
 */
export function extractNumberTokens(
  text: string,
  opts: { skipDates?: boolean; limit?: number } = {},
): NumberToken[] {
  const { folded: full, start, end } = fold(text);
  let folded = full;
  if (opts.skipDates) {
    for (const pattern of DATE_PATTERNS) folded = folded.replace(pattern, blank);
  }
  return tokenizeFolded(folded, false, opts.limit).map(({ from, to, ...rest }) => ({
    ...rest,
    raw: text.slice(start[from] ?? 0, end[to - 1] ?? text.length),
  }));
}

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  貳: 2,
  贰: 2,
  兩: 2,
  两: 2,
  三: 3,
  參: 3,
  叁: 3,
  参: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陸: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};
const CN_SMALL: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
const CN_BIG: Record<string, number> = { 萬: 1e4, 万: 1e4, 億: 1e8, 亿: 1e8 };
const CN_CHARS = "零〇一壹二貳贰兩两三參叁参四肆五伍六陸陆七柒八捌九玖十拾百佰千仟萬万億亿";
// One optional space may sit between numeral characters (一百五十 萬).
const CN_RUN = new RegExp(`[${CN_CHARS}](?: ?[${CN_CHARS}])*`, "gu");
// 3 digits is the largest unit group; a run this long is not an amount anyway.
const MAX_CN_RUN = 40;

/** The value of the numeral characters between two 萬/億 marks. */
function parseCnSegment(chars: string[]): number {
  if (chars.length === 0) return 0;
  // Digit by digit (二〇二六, 一五〇): no unit characters.
  if (chars.every((c) => c in CN_DIGIT)) return Number(chars.map((c) => CN_DIGIT[c]).join(""));
  let section = 0;
  let digit = 0;
  let lastSmall = Number.POSITIVE_INFINITY;
  for (const c of chars) {
    const d = CN_DIGIT[c];
    const small = CN_SMALL[c];
    if (d !== undefined) digit = d;
    else if (small !== undefined) {
      // 三十千: a larger unit right after a total multiplies it.
      if (digit === 0 && section > 0 && small > lastSmall) section *= small;
      else section += (digit || 1) * small;
      lastSmall = small;
      digit = 0;
    }
  }
  return section + digit;
}

/** 一百五十萬 -> 1_500_000, 一億五千萬 -> 150_000_000, 一五〇萬 -> 1_500_000, 二〇二六 -> 2026. */
function parseChineseNumeral(run: string): number {
  let total = 0;
  let segment: string[] = [];
  for (const c of run.replaceAll(" ", "")) {
    const big = CN_BIG[c];
    if (big === undefined) {
      segment.push(c);
      continue;
    }
    total += (parseCnSegment(segment) || 1) * big;
    segment = [];
  }
  return total + parseCnSegment(segment);
}

// Separators that can group digits in the privacy reading: zero-width characters are dropped
// first; NFKC folds NBSP, thin and figure spaces to a plain space.
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/gu;
// 1 500 000: single spaces, groups of exactly three digits.
const SPACE_GROUPS = /(?<!\d|\d\.)(\d{1,3})((?: \d{3})+)(?!\d)/gu;
// 1.500.000, 1'500'000, 1_500_000, 1-500-000: a leading 1-3 digits and at least two groups of
// exactly three ("1.500" alone and dates such as 2026-10-14 are not amounts).
const MARK_GROUPS = /(?<!\d)(\d{1,3})((?:[.'’_\-‐‑–−]\d{3}){2,})(?!\d)/gu;
// 150,0000 / 150 0000 / 1500 000 / 15 00 000: up to four groups of 2-4 digits split by a space or
// comma, merged only when at least six digits result (so "23 30" stays two numbers).
const LOOSE_GROUPS = /(?<!\d|\d\.)(\d{1,4})((?:[ ,]\d{2,4}){1,4})(?!\d)/gu;
// European decimal comma: 1,5 Mio.
const DECIMAL_COMMA = /(?<!\d|\d[.,])(\d{1,3}),(\d{1,2})(?!\d)/gu;

const digitsOnly = (s: string) => s.replace(/\D/gu, "");

/**
 * Absolute values of every number a human could read out of `text`, across all the readings the
 * privacy filter cares about: the lenient token forms (spaced units, million/mil/mio/MM, exponents,
 * Indian grouping), digits merged across grouping marks and spaces, European decimal commas, and
 * Chinese numerals (一百五十萬, 壹佰伍拾萬, 一五〇萬). Dates are not skipped: an amount hidden in a
 * date-like string still leaks.
 */
export function readableValues(text: string): Set<number> {
  const folded = text.replace(ZERO_WIDTH, "").normalize("NFKC");
  const groupedBy = (pattern: RegExp, keep: (head: string, rest: string) => boolean) =>
    folded.replace(pattern, (whole: string, head: string, rest: string) =>
      keep(head, rest) ? head + digitsOnly(rest) : whole,
    );
  const variants = [
    folded,
    groupedBy(SPACE_GROUPS, () => true),
    groupedBy(MARK_GROUPS, () => true),
    groupedBy(LOOSE_GROUPS, (head, rest) => head.length + digitsOnly(rest).length >= 6),
    folded.replace(DECIMAL_COMMA, "$1.$2"),
  ];
  const values = new Set<number>();
  for (const source of variants) {
    for (const t of tokenizeFolded(source, true)) values.add(Math.abs(t.value));
  }
  for (const m of folded.matchAll(CN_RUN)) {
    if (m[0].length <= MAX_CN_RUN) values.add(parseChineseNumeral(m[0]));
  }
  return values;
}
