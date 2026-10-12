import type {
  DigestSnapshot,
  FlowRow,
  QuadrantCounts,
  SectorBoard,
  SectorMover,
} from "@/sources/darkfanxing";
import { extractNumbers } from "./grounding";

/**
 * The only material the LLM sees: Traditional-Chinese bullet lines built from parsed fields, and
 * the set of numbers a briefing may use. `numbers` is derived from `text` (see `toFactSheet`), so
 * the two cannot disagree.
 */
export type FactSheet = { periodKey: string; text: string; numbers: ReadonlySet<number> };

const TOP_MOVERS = 5;
const TOP_FLOWS = 5;
const TOP_TRANSITIONS = 5;
const TOP_TURNOVER = 3;
const QUADRANT_ORDER = ["強勢", "弱勢", "轉強", "轉弱"] as const satisfies (keyof QuadrantCounts)[];

/**
 * Shortest round-trip decimal form ("49349", "-0.63", "0.2"). Parsed values come from short
 * decimal strings, so the exponent form String() uses below 1e-6 or from 1e21 does not occur.
 */
const num = (value: number): string => String(value);

/** Like `num`, with an explicit "+" on positive changes. */
const signed = (value: number): string => (value > 0 ? `+${num(value)}` : num(value));

const pct = (value: number | null): string => (value === null ? "無資料" : `${signed(value)}%`);

type BreadthStats = Pick<DigestSnapshot["market"], "upGroups" | "downGroups" | "force" | "breadth">;

const breadth = (stats: BreadthStats): string =>
  `上漲族群 ${num(stats.upGroups)}、下跌族群 ${num(stats.downGroups)}；` +
  `力度 ${pct(stats.force)}、面積 ${pct(stats.breadth)}`;

const quadrantCounts = (counts: QuadrantCounts): string =>
  QUADRANT_ORDER.map((quadrant) => `${quadrant} ${num(counts[quadrant])}`).join("、");

const moverLines = (movers: SectorMover[]): string[] =>
  movers
    .slice(0, TOP_MOVERS)
    .map((m) => `  - ${m.name}：今日 ${pct(m.changePct)}，近一月 ${pct(m.change1mPct)}`);

const flowLines = (flows: FlowRow[]): string[] =>
  flows.slice(0, TOP_FLOWS).map((f) => `  - ${f.name}：${signed(f.netFlow)} 億`);

/**
 * Joins the lines into `text` and derives `numbers` from that same text: every value
 * `extractNumbers` finds, the absolute value of each, and `extraNumbers` (with absolute values).
 */
function toFactSheet(periodKey: string, lines: string[], extraNumbers: number[]): FactSheet {
  const text = lines.join("\n");
  const numbers = new Set<number>();
  for (const value of [...extractNumbers(text), ...extraNumbers]) {
    numbers.add(value);
    numbers.add(Math.abs(value));
  }
  return { periodKey, text, numbers };
}

/**
 * Builds the daily fact sheet from structured fields only (never raw HTML or the report's prose):
 * date; 台指期 OHLC and change; group breadth, 力度 and 面積 with the previous trading day's;
 * top 5 gainers and losers; top 5 net-inflow and net-outflow sectors by 內外盤金額差; quadrant
 * counts and the first 5 transitions; the limit-up/down summary; and, with a board, market
 * turnover and the 3 highest-turnover sectors. "Top N" means the first N rows in the order the
 * report lists them. Sections the digest lacks are omitted rather than filled in.
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

  if (digest.topGainers?.length) {
    lines.push("- 漲幅前五族群（今日漲跌幅，近一月漲跌幅）：", ...moverLines(digest.topGainers));
  }
  if (digest.topLosers?.length) {
    lines.push("- 跌幅前五族群（今日漲跌幅，近一月漲跌幅）：", ...moverLines(digest.topLosers));
  }
  if (digest.netBuy?.length) {
    lines.push("- 內外盤金額差淨流入前五族群：", ...flowLines(digest.netBuy));
  }
  if (digest.netSell?.length) {
    lines.push("- 內外盤金額差淨流出前五族群：", ...flowLines(digest.netSell));
  }

  if (digest.quadrant) {
    const { counts, transitions } = digest.quadrant;
    lines.push(`- 象限族群數：${quadrantCounts(counts.today)}`);
    if (counts.prev) lines.push(`- 前一交易日象限族群數：${quadrantCounts(counts.prev)}`);
    if (transitions.length) {
      lines.push(
        "- 象限轉換（前五筆）：",
        ...transitions
          .slice(0, TOP_TRANSITIONS)
          .map(
            (t) =>
              `  - ${t.name}：${t.from} → ${t.to}` +
              `（五日斜率 ${signed(t.slope5d)}，二十日斜率 ${signed(t.slope20d)}）`,
          ),
      );
    }
  }

  if (digest.limits?.summary.length) {
    lines.push(
      "- 漲跌停：",
      ...digest.limits.summary.map((line) => `  - ${line.replace(/\s+/g, " ").trim()}`),
    );
  }

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
      "- 成交金額最高的三個族群：",
      ...busiest.map((s) => `  - ${s.name}：${num(s.turnover)} 億`),
    );
  }

  const dateDigits = digest.tradeDate.split("-").map(Number);
  return toFactSheet(digest.tradeDate, lines, dateDigits);
}
