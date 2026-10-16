/**
 * Best-effort verification of the numbers in a model answer, plus the number-parsing helper that
 * `privacy.ts` shares. Pure: no server, db or env imports.
 *
 * The verifier is advisory. It cannot prove an answer right; it flags figures that appear in the
 * text but neither match a grounded number (from the profile or a tool result) nor follow from two
 * of them by sum, difference, ratio or percent change.
 */

export interface NumberToken {
  /** The substring as the author wrote it (before NFKC folding). */
  raw: string;
  /** Signed value after unit expansion (150萬 -> 1_500_000); a percent sign leaves the value as shown. */
  value: number;
  /** Digits after the decimal point as shown. */
  decimals: number;
  /** Multiplier of the unit (1 when none); with `decimals` it fixes the shown precision. */
  scale: number;
  percent: boolean;
  /** True when the token carries a 萬/億/w/m/k unit. */
  hasUnit: boolean;
  /** True when the token is bare digits: no sign, separator, decimal, unit or percent. */
  bareInteger: boolean;
  /** The last non-space character before the token in the folded text. */
  prev: string;
}

const UNIT_SCALE: Record<string, number> = {
  億: 1e8,
  亿: 1e8,
  萬: 1e4,
  万: 1e4,
  w: 1e4,
  W: 1e4,
  m: 1e6,
  M: 1e6,
  k: 1e3,
  K: 1e3,
};

// Not preceded by a digit or the fraction part of another number; the sign may be ASCII or U+2212.
const NUMBER =
  /(?<!\d|\d\.)([-−])?(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.(\d+))?(?:\s?(億|亿|萬|万)|([wWmMkK])(?![A-Za-z])|(%))?/gu;
// 1億5000萬: the 萬 part that follows a 億 token.
const WAN_TAIL = /^\s?(\d+(?:\.\d+)?)\s?(?:萬|万)/u;

const DATE_PATTERNS = [
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/gu,
  /(?<![\d./])\d{1,2}\/\d{1,2}(?![\d/])/gu,
  /\d{4}年\d{1,2}月(?:\d{1,2}[日號号])?/gu,
  /\d{1,2}月(?:\d{1,2}[日號号]?)?/gu,
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

/**
 * Every number a human would read in `text`: plain, comma-grouped, 萬/億 (optional space), ASCII
 * w/m/k units, a trailing percent sign, full-width digits. With `skipDates`, dates and clock times
 * are not numbers.
 */
export function extractNumberTokens(
  text: string,
  opts: { skipDates?: boolean } = {},
): NumberToken[] {
  const { folded: full, start, end } = fold(text);
  let folded = full;
  if (opts.skipDates) {
    for (const pattern of DATE_PATTERNS) folded = folded.replace(pattern, blank);
  }
  const tokens: NumberToken[] = [];
  for (const m of folded.matchAll(NUMBER)) {
    const [matched, sign, int = "", frac, cjkUnit, asciiUnit, pct] = m;
    const from = m.index;
    let to = from + matched.length;
    const unit = cjkUnit ?? asciiUnit;
    let scale = unit ? (UNIT_SCALE[unit] ?? 1) : 1;
    let decimals = frac?.length ?? 0;
    let value = Number(`${int.replaceAll(",", "")}${frac ? `.${frac}` : ""}`) * scale;
    if (cjkUnit === "億" || cjkUnit === "亿") {
      const tail = WAN_TAIL.exec(folded.slice(to));
      if (tail?.[1]) {
        value += Number(tail[1]) * 1e4;
        scale = 1e4;
        decimals = tail[1].split(".")[1]?.length ?? 0;
        to += tail[0].length;
      }
    }
    // Round away binary noise such as 1.15 * 1e4.
    value = Number(value.toPrecision(12));
    if (sign) value = -value;
    tokens.push({
      raw: text.slice(start[from] ?? 0, end[to - 1] ?? text.length),
      value,
      decimals,
      scale,
      percent: pct !== undefined,
      hasUnit: unit !== undefined,
      bareInteger: !sign && !frac && !unit && !pct && !int.includes(","),
      prev: folded.slice(0, from).trimEnd().slice(-1),
    });
  }
  return tokens;
}

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
// Pairs grow quadratically; beyond this many distinct grounded numbers only direct matches count.
const MAX_DERIVE_GROUNDED = 300;

function isYear(t: NumberToken) {
  return t.bareInteger && t.value >= 1990 && t.value <= 2100;
}

/** A plain small count or an ordinal ("3 個情境", "第 2"); a decimal or percent still gets checked. */
function isSmallCountOrOrdinal(t: NumberToken) {
  return t.bareInteger && (t.value < 10 || t.prev === "第");
}

/**
 * Substrings of `text` whose number is neither within tolerance of a grounded number nor derivable
 * from two of them (sum, difference, ratio, percent change). Sign is ignored so "下跌 3.2%" matches
 * a grounded -3.2. Deduplicated, in order of first appearance.
 */
export function findUnsupportedNumbers(
  text: string,
  grounded: number[],
  opts: { relTolerance?: number } = {},
): string[] {
  const rel = opts.relTolerance ?? DEFAULT_REL_TOLERANCE;
  const base = [...new Set(grounded.filter(Number.isFinite).map(Math.abs))];
  const pairable = base.slice(0, MAX_DERIVE_GROUNDED);

  const unsupported: string[] = [];
  for (const t of extractNumberTokens(text, { skipDates: true })) {
    if (isYear(t) || isSmallCountOrOrdinal(t) || unsupported.includes(t.raw)) continue;
    const v = Math.abs(t.value);
    const half = 0.5 * 10 ** -t.decimals * t.scale;
    const near = (target: number) =>
      Math.abs(v - target) <= Math.max(rel * Math.abs(target), half + 1e-9);

    let supported = base.some((g) => near(g) || (t.percent && near(g * 100)));
    for (let i = 0; !supported && i < pairable.length; i++) {
      const a = pairable[i] as number;
      for (let j = i + 1; !supported && j < pairable.length; j++) {
        const b = pairable[j] as number;
        supported =
          near(a + b) ||
          near(Math.abs(a - b)) ||
          (b !== 0 &&
            (near(a / b) ||
              near((a / b) * 100) ||
              near(Math.abs(a - b) / b) ||
              near((Math.abs(a - b) / b) * 100))) ||
          (a !== 0 &&
            (near(b / a) ||
              near((b / a) * 100) ||
              near(Math.abs(b - a) / a) ||
              near((Math.abs(b - a) / a) * 100)));
      }
    }
    if (!supported) unsupported.push(t.raw);
  }
  return unsupported;
}
