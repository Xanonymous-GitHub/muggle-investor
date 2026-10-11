import { parseCount, parseNumber, parseTriple } from "@/sources/shared/parse-values";
import { parseTitle } from "./parse-title";
import { parseReportDocument } from "./report-document";
import { expectTable, inSection, type SectorBoard, sectorBoardSchema, validate } from "./schemas";

const HEADERS = [
  "排名",
  "族群",
  "今日%",
  "上漲/下跌/平盤",
  "檔數",
  "成交金額(億)",
  "金額排名",
  "較昨日同時刻%",
  "漲停數量",
  "跌停數量",
  "近1月%",
] as const;

const MARKET_TURNOVER =
  /全市場成分股合計成交 ([\d.,]+) 億（前一交易日同時刻 ([\d.,]+) 億，([+-][\d.]+)%）/;

/** Parses the all-sector board report (`/now`). */
export function parseSectorBoard(html: string): SectorBoard {
  const doc = parseReportDocument(html);

  const marketTurnover = inSection("intro", () => {
    const intro = doc.intro.join("\n");
    const match = MARKET_TURNOVER.exec(intro);
    if (!match) {
      if (intro.includes("全市場成分股合計成交")) throw new Error("unrecognised market turnover");
      return null;
    }
    return {
      today: parseNumber(match[1] as string),
      prevSameTime: parseNumber(match[2] as string),
      changePct: parseNumber(match[3] as string),
    };
  });

  const sectors = inSection("sectors", () =>
    expectTable(doc.introTables[0], HEADERS, "sectors").map((row) => {
      const [rank, name, today, upDown, size, turnover, turnoverRank, vsPrev, up, down, month] =
        row;
      const [advancers, decliners, unchanged] = parseTriple(upDown);
      return {
        rank: parseNumber(rank),
        name,
        changePct: parseNumber(today),
        advancers,
        decliners,
        unchanged,
        constituents: parseNumber(size),
        turnover: parseNumber(turnover),
        turnoverRank: parseNumber(turnoverRank),
        turnoverVsPrevPct: parseNumber(vsPrev),
        limitUp: parseCount(up),
        limitDown: parseCount(down),
        change1mPct: parseNumber(month),
      };
    }),
  );

  return validate(
    sectorBoardSchema,
    { ...parseTitle(doc.title), marketTurnover, sectors },
    "sector board",
  );
}
