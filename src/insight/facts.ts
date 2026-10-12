import type {
  DigestSnapshot,
  FlowRow,
  QuadrantCounts,
  SectorBoard,
  SectorMover,
} from "@/sources/darkfanxing";
import { extractNumerals } from "./grounding";

/**
 * The only material the LLM sees: Traditional-Chinese bullet lines built from parsed fields, and
 * the numbers a briefing may use. `numbers` and `precisions` are derived from `text` (see
 * `factSheetFromText`), so they cannot disagree with it.
 */
export type FactSheet = {
  periodKey: string;
  text: string;
  /** Every numeral in `text` (signed as written), the absolute value of each, plus extras. */
  numbers: ReadonlySet<number>;
  /**
   * Decimal places each number is written with in `text`, keyed by absolute value; the fewest when
   * a value is written more than once. Bounds how far a briefing may round it.
   */
  precisions: ReadonlyMap<number, number>;
};

const TOP_MOVERS = 5;
const TOP_FLOWS = 5;
const TOP_TRANSITIONS = 5;
const TOP_TURNOVER = 3;
const QUADRANT_ORDER = ["強勢", "弱勢", "轉強", "轉弱"] as const satisfies (keyof QuadrantCounts)[];
/** Labels say counts in Chinese, so the only Arabic numerals in the text are data values. */
const COUNT_WORDS = ["一", "兩", "三", "四", "五"] as const;

/**
 * Shortest round-trip decimal form ("49349", "-0.63", "0.2"). Parsed values come from short
 * decimal strings, so the exponent form String() uses below 1e-6 or from 1e21 does not occur.
 */
const num = (value: number): string => String(value);

/** Like `num`, with an explicit "+" on positive changes. */
const signed = (value: number): string => (value > 0 ? `+${num(value)}` : num(value));

const pct = (value: number | null): string => (value === null ? "無資料" : `${signed(value)}%`);

/** Decimal places in `num(value)`. */
const decimalsOf = (value: number): number => num(value).split(".")[1]?.length ?? 0;

type BreadthStats = Pick<DigestSnapshot["market"], "upGroups" | "downGroups" | "force" | "breadth">;

const breadth = (stats: BreadthStats): string =>
  `上漲族群 ${num(stats.upGroups)}、下跌族群 ${num(stats.downGroups)}；` +
  `力度 ${pct(stats.force)}、面積 ${pct(stats.breadth)}`;

const quadrantCounts = (counts: QuadrantCounts): string =>
  QUADRANT_ORDER.map((quadrant) => `${quadrant} ${num(counts[quadrant])}`).join("、");

/**
 * A heading line followed by its items as nested bullets, or nothing when there are no items.
 * `heading` receives the Chinese count word for the real number of items (up to five).
 */
const section = (heading: (count: string) => string, items: string[]): string[] =>
  items.length === 0
    ? []
    : [
        `- ${heading(COUNT_WORDS[items.length - 1] ?? num(items.length))}`,
        ...items.map((item) => `  - ${item}`),
      ];

const moverItems = (movers: SectorMover[] | null): string[] =>
  (movers ?? [])
    .slice(0, TOP_MOVERS)
    .map((m) => `${m.name}：今日 ${pct(m.changePct)}，近一月 ${pct(m.change1mPct)}`);

const flowItems = (flows: FlowRow[] | null): string[] =>
  (flows ?? []).slice(0, TOP_FLOWS).map((f) => `${f.name}：${signed(f.netFlow)} 億`);

/**
 * Builds a fact sheet whose `numbers` and `precisions` come from `text` itself: every numeral
 * `extractNumerals` finds (with its absolute value and written decimal places), plus
 * `extraNumbers` (with absolute values; precision as `String` writes them).
 */
export function factSheetFromText(
  periodKey: string,
  text: string,
  extraNumbers: readonly number[] = [],
): FactSheet {
  const numbers = new Set<number>();
  const precisions = new Map<number, number>();
  const record = (value: number, decimals: number) => {
    const magnitude = Math.abs(value);
    numbers.add(value);
    numbers.add(magnitude);
    precisions.set(magnitude, Math.min(precisions.get(magnitude) ?? decimals, decimals));
  };
  for (const numeral of extractNumerals(text)) record(numeral.value, numeral.decimals);
  for (const value of extraNumbers) record(value, decimalsOf(value));
  return { periodKey, text, numbers, precisions };
}

/**
 * Builds the daily fact sheet from structured fields only (never raw HTML or the report's prose):
 * date; 台指期 OHLC and change; group breadth, 力度 and 面積 with the previous trading day's;
 * top 5 gainers and losers; top 5 net-inflow and net-outflow sectors by 內外盤金額差; quadrant
 * counts and the first 5 transitions; the limit-up/down summary; and, with a board, market
 * turnover and the 3 highest-turnover sectors. "Top N" means the first N rows in the order the
 * report lists them, and each heading names the real number of rows. Sections the digest lacks,
 * or that have no rows, are omitted rather than filled in.
 *
 * Throws if `board` is for a different trade date than `digest`.
 */
export function buildDailyFacts(digest: DigestSnapshot, board: SectorBoard | null): FactSheet {
  if (board && board.tradeDate !== digest.tradeDate) {
    throw new Error(
      `Sector board is for ${board.tradeDate} but the digest is for ${digest.tradeDate}`,
    );
  }

  const { market } = digest;
  const lines = [`- 交易日：${digest.tradeDate}`];

  if (market.futures) {
    const f = market.futures;
    lines.push(
      `- 台指期近月：開 ${num(f.open)}、高 ${num(f.high)}、低 ${num(f.low)}、收 ${num(f.close)}，` +
        `漲跌 ${signed(f.change)} 點（${pct(f.changePct)}）`,
    );
  }

  lines.push(`- 族群漲跌：${breadth(market)}`);
  if (market.prev) lines.push(`- 前一交易日族群漲跌：${breadth(market.prev)}`);

  lines.push(
    ...section(
      (n) => `漲幅前${n}族群（今日漲跌幅，近一月漲跌幅）：`,
      moverItems(digest.topGainers),
    ),
    ...section((n) => `跌幅前${n}族群（今日漲跌幅，近一月漲跌幅）：`, moverItems(digest.topLosers)),
    ...section((n) => `內外盤金額差淨流入前${n}族群：`, flowItems(digest.netBuy)),
    ...section((n) => `內外盤金額差淨流出前${n}族群：`, flowItems(digest.netSell)),
  );

  if (digest.quadrant) {
    const { counts, transitions } = digest.quadrant;
    lines.push(`- 象限族群數：${quadrantCounts(counts.today)}`);
    if (counts.prev) lines.push(`- 前一交易日象限族群數：${quadrantCounts(counts.prev)}`);
    lines.push(
      ...section(
        (n) => `象限轉換（前${n}筆）：`,
        transitions
          .slice(0, TOP_TRANSITIONS)
          .map(
            (t) =>
              `${t.name}：${t.from} → ${t.to}` +
              `（五日斜率 ${signed(t.slope5d)}，二十日斜率 ${signed(t.slope20d)}）`,
          ),
      ),
    );
  }

  lines.push(
    ...section(
      () => "漲跌停：",
      (digest.limits?.summary ?? []).map((line) => line.replace(/\s+/g, " ").trim()),
    ),
  );

  if (board) {
    const turnover = board.marketTurnover;
    if (turnover) {
      lines.push(
        `- 成交金額：${num(turnover.today)} 億` +
          `（前一交易日同時段 ${num(turnover.prevSameTime)} 億，增減 ${pct(turnover.changePct)}）`,
      );
    }
    const busiest = [...board.sectors]
      .sort((a, b) => b.turnover - a.turnover || a.turnoverRank - b.turnoverRank)
      .slice(0, TOP_TURNOVER);
    lines.push(
      ...section(
        (n) => `成交金額最高的${n}個族群：`,
        busiest.map((s) => `${s.name}：${num(s.turnover)} 億`),
      ),
    );
  }

  const dateDigits = digest.tradeDate.split("-").map(Number);
  return factSheetFromText(digest.tradeDate, lines.join("\n"), dateDigits);
}
