import type { DigestSnapshot, SectorMover } from "@/sources/darkfanxing";
import {
  breadth,
  type FactSheet,
  factSheetFromText,
  nameOf,
  num,
  pct,
  section,
  signed,
} from "./facts";
import { isoWeekKey, weekRange } from "./week";

/** One trading day of a week: its digest and, when one is stored, its daily briefing's summary. */
export type WeeklyDay = { digest: DigestSnapshot; dailySummary: string | null };

/**
 * Heading of the earlier daily summaries in the weekly fact text. Their numbers are not facts:
 * only the deterministic lines above them ground a weekly briefing.
 */
export const EARLIER_SUMMARIES_HEADING =
  "先前的每日簡報摘要（僅供理解當天重點，其中的數字不算 FACTS）";

const TOP_RECURRING = 5;
const MIN_RECURRING_DAYS = 2;
const TOP_CUMULATIVE = 5;
const TOP_QUADRANT_CHANGES = 10;

/**
 * Rounds half away from zero to two decimals, so sums and quotients are written without binary
 * floating-point noise (57.44 + 10.5 → 67.94, not 67.93999999999999).
 */
const round2 = (value: number): number =>
  (Math.sign(value) * Math.round(Math.abs(value) * 100)) / 100;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Futures prices are whole points; a gap beyond this between two closes is not rounding. */
const CHAIN_TOLERANCE = 0.5;

const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The weekday that follows `date` (Friday → Monday), as a "YYYY-MM-DD" string. */
function nextWeekday(date: string): string {
  const skip = weekdayOf(date) === 5 ? 3 : weekdayOf(date) === 6 ? 2 : 1;
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + skip * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * True when two consecutive futures days that are adjacent weekdays do not chain: the later
 * day's close minus its change should be the earlier day's close. A break means the contract
 * rolled over (or the data is inconsistent), so the days are not one comparable series. Days
 * that are not adjacent weekdays cannot be checked (a holiday or a missing digest sits between).
 */
function breaksChain(days: DigestSnapshot[]): boolean {
  return days.some((day, i) => {
    const previous = days[i - 1];
    const today = day.market.futures;
    const before = previous?.market.futures;
    if (!previous || !today || !before) return false;
    if (nextWeekday(previous.tradeDate) !== day.tradeDate) return false;
    return Math.abs(today.close - today.change - before.close) > CHAIN_TOLERANCE;
  });
}

/** True when the third Wednesday of a month (the monthly contract's settlement day) is in the week. */
function hasSettlementDay(from: string, to: string): boolean {
  for (let day = from; day <= to; day = nextCalendarDay(day)) {
    const [, , dd] = day.split("-").map(Number);
    if (weekdayOf(day) === 3 && dd !== undefined && dd >= 15 && dd <= 21) return true;
  }
  return false;
}

const nextCalendarDay = (date: string): string =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);

/**
 * The week's 台指期 change, from the close before the first day with futures data
 * (its close − its change) to the last day's close. Omitted when no day has futures data, or
 * when the days do not chain (see `breaksChain`). A week that holds the monthly settlement day
 * says so on the line, since the near-month contract may change there.
 */
function weekChange(days: DigestSnapshot[], from: string, to: string): string[] {
  const withFutures = days.filter((day) => day.market.futures !== null);
  const first = withFutures[0];
  const last = withFutures.at(-1);
  if (!first?.market.futures || !last?.market.futures) return [];
  if (breaksChain(withFutures)) return [];
  const base = first.market.futures.close - first.market.futures.change;
  if (!(base > 0)) return [];
  const lastClose = last.market.futures.close;
  const settlement = hasSettlementDay(from, to)
    ? "（本週含近月合約結算日，換月前後的價位可能不是同一個合約）"
    : "";
  return [
    `- 本週台指期近月：${first.tradeDate} 前一交易日收盤 ${num(round2(base))}，` +
      `${last.tradeDate} 收盤 ${num(lastClose)}；` +
      `本週漲跌 ${signed(round2(lastClose - base))} 點（${pct(round2(((lastClose - base) / base) * 100))}）${settlement}`,
  ];
}

function dayLine(day: DigestSnapshot): string {
  const f = day.market.futures;
  const futures = f
    ? `台指期近月收 ${num(f.close)}，漲跌 ${signed(f.change)} 點（${pct(f.changePct)}）`
    : "台指期近月無資料";
  return `${day.tradeDate}：${futures}；${breadth(day.market)}`;
}

/** Sectors listed on at least two days, most days first (ties: first listed first). */
function recurringSectors(lists: (SectorMover[] | null)[]): string[] {
  const dayCounts = new Map<string, number>();
  for (const list of lists) {
    for (const name of new Set((list ?? []).map((mover) => mover.name))) {
      dayCounts.set(name, (dayCounts.get(name) ?? 0) + 1);
    }
  }
  return [...dayCounts]
    .filter(([, count]) => count >= MIN_RECURRING_DAYS)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_RECURRING)
    .map(([name, count]) => `${nameOf(name)}：上榜 ${num(count)} 天`);
}

type Cumulative = { name: string; total: number; days: number };

/**
 * For every sector in a day's `netBuy` or `netSell` list, the sum of its 內外盤金額差 over the
 * days it was listed, with the number of those days. Days it was not listed are not counted, so
 * this is not the sector's whole-week flow.
 */
function cumulativeFlows(days: DigestSnapshot[]): Cumulative[] {
  const totals = new Map<string, { total: number; days: number }>();
  for (const day of days) {
    const listed = new Map<string, number>();
    for (const row of [...(day.netBuy ?? []), ...(day.netSell ?? [])]) {
      if (!listed.has(row.name)) listed.set(row.name, row.netFlow);
    }
    for (const [name, netFlow] of listed) {
      const entry = totals.get(name) ?? { total: 0, days: 0 };
      totals.set(name, { total: entry.total + netFlow, days: entry.days + 1 });
    }
  }
  return [...totals].map(([name, { total, days }]) => ({ name, total: round2(total), days }));
}

const cumulativeItem = (c: Cumulative): string =>
  `${nameOf(c.name)}：上榜累計 ${signed(c.total)} 億（上榜 ${num(c.days)} 天）`;

/** Each sector's quadrant transitions in date order, most transitions first. */
function quadrantChanges(days: DigestSnapshot[]): string[] {
  const steps = new Map<string, string[]>();
  for (const day of days) {
    for (const t of day.quadrant?.transitions ?? []) {
      steps.set(t.name, [...(steps.get(t.name) ?? []), `${day.tradeDate} ${t.from} → ${t.to}`]);
    }
  }
  return [...steps]
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, TOP_QUADRANT_CHANGES)
    .map(([name, list]) => `${nameOf(name)}：${list.join("；")}`);
}

/**
 * Builds the weekly fact sheet from the week's digests, in the same line format as the daily
 * facts. `numbers` and `precisions` come from the deterministic lines only; the stored daily
 * summaries (LLM-written) follow them in `text` as labelled narrative and never ground a number. Every derived figure — the week's 台指期 change, how many days
 * a sector was listed, and 上榜累計 sums — is computed here and written into the text, so the LLM
 * only ever copies numbers. Sections without rows are omitted.
 *
 * Throws when `days` is empty, has a day outside `weekKey`, or repeats a trade date.
 */
export function buildWeeklyFacts(weekKey: string, days: WeeklyDay[]): FactSheet {
  const { from, to } = weekRange(weekKey);
  if (days.length === 0) throw new Error(`No days given for week ${weekKey}`);
  const sorted = [...days].sort((a, b) => a.digest.tradeDate.localeCompare(b.digest.tradeDate));
  sorted.forEach(({ digest }, i) => {
    if (isoWeekKey(digest.tradeDate) !== weekKey) {
      throw new Error(`Day ${digest.tradeDate} is not in week ${weekKey}`);
    }
    if (sorted[i - 1]?.digest.tradeDate === digest.tradeDate) {
      throw new Error(`Day ${digest.tradeDate} is given more than once`);
    }
  });
  const digests = sorted.map((day) => day.digest);

  const cumulative = cumulativeFlows(digests);
  const inflow = cumulative
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_CUMULATIVE);
  const outflow = cumulative
    .filter((c) => c.total < 0)
    .sort((a, b) => a.total - b.total)
    .slice(0, TOP_CUMULATIVE);
  const listedDaysNote = "只加總該族群列入當日淨流入或淨流出榜的交易日";

  const lines = [
    `- 週次：${weekKey}（${from} 至 ${to}）`,
    ...weekChange(digests, from, to),
    ...section((n) => `本週有資料的${n}個交易日：`, digests.map(dayLine)),
    ...section(
      (n) => `漲幅榜上榜天數最多的${n}個族群：`,
      recurringSectors(digests.map((d) => d.topGainers)),
    ),
    ...section(
      (n) => `跌幅榜上榜天數最多的${n}個族群：`,
      recurringSectors(digests.map((d) => d.topLosers)),
    ),
    ...section(
      (n) => `內外盤金額差上榜累計淨流入前${n}族群（${listedDaysNote}）：`,
      inflow.map(cumulativeItem),
    ),
    ...section(
      (n) => `內外盤金額差上榜累計淨流出前${n}族群（${listedDaysNote}）：`,
      outflow.map(cumulativeItem),
    ),
    ...section(
      (n) => `本週象限轉換的族群（轉換次數多的在前，列出${n}個）：`,
      quadrantChanges(digests),
    ),
  ];

  // Earlier LLM-written summaries are narrative context only: they are appended after the
  // numbers and precisions are taken from the deterministic lines above, so no figure in a
  // summary can ground a weekly briefing.
  const summaries = section(
    () => `${EARLIER_SUMMARIES_HEADING}：`,
    sorted.flatMap(({ digest, dailySummary }) => {
      const summary = dailySummary?.replace(/\s+/g, " ").trim();
      return summary ? [`${digest.tradeDate}：${summary}`] : [];
    }),
  );
  const sheet = factSheetFromText(weekKey, lines.join("\n"));
  return { ...sheet, text: [...lines, ...summaries].join("\n") };
}
