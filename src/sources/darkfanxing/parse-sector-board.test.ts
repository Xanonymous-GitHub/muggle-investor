import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSectorBoard } from "./parse-sector-board";
import { DarkfanxingParseError } from "./schemas";

const html = readFileSync("test/fixtures/darkfanxing/now-2026-10-08.html", "utf8");

describe("parseSectorBoard", () => {
  const board = parseSectorBoard(html);

  it("reads the title metadata", () => {
    expect(board.tradeDate).toBe("2026-10-08");
    expect(board.asOf).toBe("13:34");
    expect(board.session).toBe("closed");
  });

  it("reads the market turnover from the intro", () => {
    expect(board.marketTurnover).toEqual({ today: 10465, prevSameTime: 11500.4, changePct: -9 });
  });

  it("reads every sector row", () => {
    expect(board.sectors).toHaveLength(175);
    expect(board.sectors[0]).toEqual({
      rank: 1,
      name: "不織布",
      changePct: 5.97,
      advancers: 4,
      decliners: 1,
      unchanged: 0,
      constituents: 5,
      turnover: 2.3,
      turnoverRank: 128,
      turnoverVsPrevPct: 146.8,
      limitUp: 0,
      limitDown: 0,
      change1mPct: 9.3,
    });
    const last = board.sectors.at(-1);
    expect(last?.name).toBe("矽晶圓");
    expect(last?.changePct).toBe(-3.36);
  });

  it("yields null market turnover when the intro omits it", () => {
    const withoutTurnover = html.replace(/全市場成分股合計成交[^。]*。/, "");
    expect(parseSectorBoard(withoutTurnover).marketTurnover).toBeNull();
  });

  it("throws when the market turnover sentence is present but malformed", () => {
    const malformed = html.replace("前一交易日同時刻 11500.4 億", "前一交易日 11500.4 億");
    expect(() => parseSectorBoard(malformed)).toThrow(DarkfanxingParseError);
  });

  it("throws a DarkfanxingParseError when the table is missing", () => {
    const noTable = html.replace(/<table>[\s\S]*<\/table>/, "");
    expect(() => parseSectorBoard(noTable)).toThrow(DarkfanxingParseError);
  });

  it("throws a DarkfanxingParseError on a garbage cell", () => {
    const garbage = html.replace("<td>+5.97</td>", "<td>abc</td>");
    expect(() => parseSectorBoard(garbage)).toThrow(DarkfanxingParseError);
  });
});
