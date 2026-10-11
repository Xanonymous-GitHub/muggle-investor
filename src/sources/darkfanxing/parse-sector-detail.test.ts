import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSectorDetail } from "./parse-sector-detail";
import { DarkfanxingParseError } from "./schemas";

const html = readFileSync("test/fixtures/darkfanxing/group-quartz-2026-10-08.html", "utf8");

describe("parseSectorDetail", () => {
  const detail = parseSectorDetail(html);

  it("reads the group summary", () => {
    expect(detail.group).toBe("石英元件");
    expect(detail.tradeDate).toBe("2026-10-08");
    expect(detail.asOf).toBe("13:34");
    expect(detail.changePct).toBe(3.93);
    expect(detail.rank).toBe(2);
    expect(detail.rankOf).toBe(175);
    expect(detail.change1mPct).toBe(31.7);
  });

  it("reads the constituent stocks", () => {
    expect(detail.stocks).toHaveLength(5);
    expect(detail.stocks[0]).toEqual({
      name: "安碁",
      code: "6174",
      changePct: 9.97,
      turnover: 6.37,
      turnoverVsPrevPct: 90.4,
      change1mPct: 59,
      noTrade: false,
    });
  });

  it("flags stocks with no trade today", () => {
    const noTradeRow =
      "<tr><td>某股 1234</td><td>+1.00</td><td>—</td><td>—</td><td>+2.0</td><td>無成交</td></tr>";
    const withNoTrade = html.replace("</tbody>", `${noTradeRow}</tbody>`);
    const stock = parseSectorDetail(withNoTrade).stocks.at(-1);
    expect(stock).toEqual({
      name: "某股",
      code: "1234",
      changePct: 1,
      turnover: 0,
      turnoverVsPrevPct: null,
      change1mPct: 2,
      noTrade: true,
    });
  });

  it("throws a DarkfanxingParseError when the intro summary is missing", () => {
    const noSummary = html.replace(/族群今日[^，]*，/, "");
    expect(() => parseSectorDetail(noSummary)).toThrow(DarkfanxingParseError);
  });
});
