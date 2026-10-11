import { parseNumber, parseStockLabel } from "@/sources/shared/parse-values";
import { parseTitle } from "./parse-title";
import { parseReportDocument } from "./report-document";
import {
  DarkfanxingParseError,
  expectTable,
  inSection,
  type SectorDetail,
  sectorDetailSchema,
  validate,
} from "./schemas";

const HEADERS = ["個股", "今日%", "成交金額(億)", "較昨日同時刻%", "近1月%", "狀態"] as const;

const GROUP_NAME = /族群「(.+?)」/;
const GROUP_SUMMARY =
  /族群今日 ([+\-−]?[\d.]+)%（漲跌幅排名 (\d+)\/(\d+)）、近 1 月 ([+\-−]?[\d.]+)%/;

/** Parses a single-sector constituent report (`/group/{name}`). */
export function parseSectorDetail(html: string): SectorDetail {
  const doc = parseReportDocument(html);

  const group = GROUP_NAME.exec(doc.title)?.[1];
  if (!group) {
    throw new DarkfanxingParseError(`no group name in title "${doc.title}"`, { section: "title" });
  }

  const summary = inSection("intro", () => {
    const match = GROUP_SUMMARY.exec(doc.intro.join("\n"));
    if (!match) throw new Error("group summary (族群今日 …) not found");
    return {
      changePct: parseNumber(match[1] as string),
      rank: parseNumber(match[2] as string),
      rankOf: parseNumber(match[3] as string),
      change1mPct: parseNumber(match[4] as string),
    };
  });

  const stocks = inSection("stocks", () =>
    expectTable(doc.introTables[0], HEADERS, "stocks").map(
      ([label, today, turnover, vsPrev, month, status]) => {
        const noTrade = status.includes("無成交");
        return {
          ...parseStockLabel(label),
          changePct: parseNumber(today),
          // A stock without a trade today has no turnover; anything else must be a number.
          turnover: parseNumber(turnover) ?? (noTrade ? 0 : null),
          turnoverVsPrevPct: parseNumber(vsPrev),
          change1mPct: parseNumber(month),
          noTrade,
        };
      },
    ),
  );

  const { tradeDate, asOf } = parseTitle(doc.title);
  return validate(
    sectorDetailSchema,
    { group, tradeDate, asOf, ...summary, stocks },
    "sector detail",
  );
}
