import { parseCount, parseMovers, parseNumber, parsePair } from "@/sources/shared/parse-values";
import { parseTitle } from "./parse-title";
import {
  findSection,
  parseReportDocument,
  type ReportDocument,
  type ReportSection,
} from "./report-document";
import {
  DarkfanxingParseError,
  type DigestSnapshot,
  digestSnapshotSchema,
  expectTable,
  inSection,
  validate,
} from "./schemas";

const N = String.raw`([+\-−]?\d+(?:\.\d+)?)`;
const TIME = String.raw`(\d{2}:\d{2})`;
const QUADRANT = "(強勢|弱勢|轉強|轉弱)";

const FUTURES = new RegExp(
  `開 ${N}、高 ${N}(?:（${TIME}）)?、低 ${N}(?:（${TIME}）)?、收 ${N}，漲跌 ${N} 點（${N}%）`,
);
const MARKET = new RegExp(`^${TIME} 上漲族群 (\\d+)、下跌 (\\d+)；力度 ${N}%、面積 ${N}%`);
const MARKET_PREV = new RegExp(
  `（前一交易日收盤：上漲 (\\d+)／下跌 (\\d+)、力度 ${N}%、面積 ${N}%）`,
);
const QUADRANT_COUNTS = /^今日家數：(.+?)(?:；前一交易日：(.+))?$/;
const QUADRANT_COUNT = new RegExp(`^${QUADRANT} (\\d+)$`);
const QUADRANT_LEADERS = /^(近 \d+ 日流[入出]最強)：(.+)$/;
const QUADRANT_LEADER = new RegExp(`^(.+)（${N}／${N}，${QUADRANT}）$`);

const RHYTHM_HEADERS = ["時間", "上漲/下跌族群", "力度%", "面積%", "當時領漲", "當時領跌"] as const;
const MOVER_HEADERS = [
  "族群",
  "今日%",
  "近1月%",
  "檔數",
  "上漲家數比%",
  "漲停鎖死檔數",
  "跌停鎖死檔數",
  "代表個股",
] as const;
const FLOW_HEADERS = [
  "族群",
  "內外盤金額差(億)",
  "前一日(億)",
  "成交金額(億)",
  "占全市場%",
  "集中倍數",
  "今日%",
] as const;
const TRANSITION_HEADERS = [
  "族群",
  "由",
  "到",
  "近5日斜率",
  "近20日斜率",
  "今日內外盤差(億)",
] as const;

const num = (text: string | undefined) => (text === undefined ? null : parseNumber(text));

/** Parses the section if present; a present-but-malformed section throws, an absent one is null. */
function optionalSection<T>(
  doc: ReportDocument,
  heading: string,
  parse: (section: ReportSection) => T,
): T | null {
  const section = findSection(doc, heading);
  return section ? inSection(heading, () => parse(section)) : null;
}

function parseMarket(section: ReportSection) {
  const futuresItem = section.items.find((item) => item.startsWith("台指期"));
  let futures = null;
  if (futuresItem) {
    const m = FUTURES.exec(futuresItem);
    if (!m) throw new Error(`unrecognised futures line "${futuresItem}"`);
    futures = {
      open: num(m[1]),
      high: num(m[2]),
      low: num(m[4]),
      close: num(m[6]),
      change: num(m[7]),
      changePct: num(m[8]),
    };
  }

  const marketItem = section.items.find((item) => MARKET.test(item));
  const m = marketItem ? MARKET.exec(marketItem) : null;
  if (!marketItem || !m) throw new Error("market breadth line (上漲族群 …) not found");
  const p = MARKET_PREV.exec(marketItem);
  return {
    futures,
    upGroups: num(m[2]),
    downGroups: num(m[3]),
    force: num(m[4]),
    breadth: num(m[5]),
    prev: p
      ? { upGroups: num(p[1]), downGroups: num(p[2]), force: num(p[3]), breadth: num(p[4]) }
      : null,
  };
}

function parseRhythm(section: ReportSection) {
  return expectTable(section.tables[0], RHYTHM_HEADERS, section.heading).map(
    ([time, upDown, force, breadth, leaders, laggers]) => {
      const [upGroups, downGroups] = parsePair(upDown);
      return {
        time,
        upGroups,
        downGroups,
        force: parseNumber(force),
        breadth: parseNumber(breadth),
        leaders: parseMovers(leaders),
        laggers: parseMovers(laggers),
      };
    },
  );
}

function parseSectorMovers(section: ReportSection) {
  return expectTable(section.tables[0], MOVER_HEADERS, section.heading).map(
    ([name, today, month, size, upRatio, upLocked, downLocked, representatives]) => ({
      name,
      changePct: parseNumber(today),
      change1mPct: parseNumber(month),
      constituents: parseNumber(size),
      advancerRatioPct: parseNumber(upRatio),
      limitUpLocked: parseCount(upLocked),
      limitDownLocked: parseCount(downLocked),
      representatives: parseMovers(representatives),
    }),
  );
}

function parseFlows(section: ReportSection) {
  return expectTable(section.tables[0], FLOW_HEADERS, section.heading).map(
    ([name, net, prev, turnover, share, concentration, today]) => ({
      name,
      netFlow: parseNumber(net),
      prevNetFlow: parseNumber(prev),
      turnover: parseNumber(turnover),
      marketSharePct: parseNumber(share),
      concentration: parseNumber(concentration),
      changePct: parseNumber(today),
    }),
  );
}

function parseQuadrantCounts(text: string) {
  return Object.fromEntries(
    text.split("、").map((part) => {
      const m = QUADRANT_COUNT.exec(part.trim());
      if (!m) throw new Error(`unrecognised quadrant count "${part}"`);
      return [m[1], Number(m[2])];
    }),
  );
}

function parseQuadrant(section: ReportSection) {
  const countsItem = section.items.find((item) => item.startsWith("今日家數："));
  const counts = countsItem ? QUADRANT_COUNTS.exec(countsItem) : null;
  if (!counts) throw new Error("quadrant counts line (今日家數：…) not found");

  const leaders = section.items.flatMap((item) => {
    const m = QUADRANT_LEADERS.exec(item);
    if (!m) return [];
    const entries = (m[2] as string).split(/(?<=）)、/).map((entry) => {
      const e = QUADRANT_LEADER.exec(entry.trim());
      if (!e) throw new Error(`unrecognised quadrant leader "${entry}"`);
      return { name: e[1], slope5d: num(e[2]), slope20d: num(e[3]), quadrant: e[4] };
    });
    return [{ label: m[1], entries }];
  });

  const transitions = expectTable(section.tables[0], TRANSITION_HEADERS, section.heading).map(
    ([name, from, to, slope5d, slope20d, netFlowToday]) => ({
      name,
      from,
      to,
      slope5d: parseNumber(slope5d),
      slope20d: parseNumber(slope20d),
      netFlowToday: parseNumber(netFlowToday),
    }),
  );

  return {
    counts: {
      today: parseQuadrantCounts(counts[1] as string),
      prev: counts[2] === undefined ? null : parseQuadrantCounts(counts[2]),
    },
    transitions,
    leaders,
  };
}

/** The 漲跌停 summary plus the level-3 sub-sections that follow it. */
function parseLimits(doc: ReportDocument, section: ReportSection) {
  const start = doc.sections.indexOf(section) + 1;
  const end = doc.sections.findIndex((s, i) => i >= start && s.level === 2);
  return {
    summary: section.items,
    tables: doc.sections.slice(start, end === -1 ? undefined : end),
  };
}

function parseGlossary(section: ReportSection) {
  return section.items.map((item) => {
    const split = item.indexOf("：");
    if (split <= 0) throw new Error(`glossary item without "：": "${item}"`);
    return { term: item.slice(0, split).trim(), definition: item.slice(split + 1).trim() };
  });
}

/** Parses the daily market digest report (`/digest`). */
export function parseDigest(html: string): DigestSnapshot {
  const doc = parseReportDocument(html);

  const marketSection = findSection(doc, "大盤");
  if (!marketSection) throw new DarkfanxingParseError("section missing", { section: "大盤" });

  const snapshot = {
    ...parseTitle(doc.title),
    market: inSection("大盤", () => parseMarket(marketSection)),
    rhythm: optionalSection(doc, "盤中節奏", parseRhythm) ?? [],
    topGainers: optionalSection(doc, "族群漲幅前", parseSectorMovers),
    topLosers: optionalSection(doc, "族群跌幅前", parseSectorMovers),
    netBuy: optionalSection(doc, "資金：淨主動買", parseFlows),
    netSell: optionalSection(doc, "資金：淨主動賣", parseFlows),
    quadrant: optionalSection(doc, "資金趨勢四象限", parseQuadrant),
    limits: optionalSection(doc, "漲跌停", (section) => parseLimits(doc, section)),
    glossary: optionalSection(doc, "詞彙表", parseGlossary) ?? [],
    caveats: doc.intro.flatMap((paragraph) =>
      paragraph
        .split(/(?<=。)/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0),
    ),
  };

  return validate(digestSnapshotSchema, snapshot, "digest");
}
