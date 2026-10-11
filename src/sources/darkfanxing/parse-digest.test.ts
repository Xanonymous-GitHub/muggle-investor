import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDigest } from "./parse-digest";
import { DarkfanxingParseError } from "./schemas";

const html = readFileSync("test/fixtures/darkfanxing/digest-2026-10-08.html", "utf8");

/** Removes every <h2> section whose heading starts with `prefix`, up to the next <h2>. */
const removeSection = (source: string, prefix: string) =>
  source.replace(new RegExp(`<h2>${prefix}[\\s\\S]*?(?=<h2>)`, "g"), "");

describe("parseDigest", () => {
  const digest = parseDigest(html);

  it("reads the title metadata", () => {
    expect(digest.tradeDate).toBe("2026-10-08");
    expect(digest.asOf).toBeNull();
    expect(digest.session).toBe("closed");
  });

  it("reads the market overview", () => {
    expect(digest.market.futures).toEqual({
      open: 49480,
      high: 49692,
      low: 49333,
      close: 49349,
      change: -619,
      changePct: -1.24,
    });
    expect(digest.market.upGroups).toBe(87);
    expect(digest.market.downGroups).toBe(88);
    expect(digest.market.force).toBe(-0.63);
    expect(digest.market.breadth).toBe(0.2);
    expect(digest.market.prev).toEqual({
      upGroups: 120,
      downGroups: 53,
      force: 1.38,
      breadth: 0.91,
    });
  });

  it("reads the intraday rhythm", () => {
    expect(digest.rhythm).toHaveLength(6);
    expect(digest.rhythm[0]).toMatchObject({
      time: "09:10",
      upGroups: 69,
      downGroups: 101,
      force: -0.29,
      breadth: 0.2,
    });
    expect(digest.rhythm[0]?.leaders[0]).toEqual({ name: "染料，顏料", changePct: 4.3 });
    expect(digest.rhythm[0]?.laggers).toHaveLength(3);
  });

  it("reads the top gainers and losers", () => {
    expect(digest.topGainers?.[0]).toEqual({
      name: "不織布",
      changePct: 5.97,
      change1mPct: 9.3,
      constituents: 5,
      advancerRatioPct: 80,
      limitUpLocked: 3,
      limitDownLocked: 0,
      representatives: [
        { name: "康那香", changePct: 9.9 },
        { name: "恆大", changePct: 9.9 },
        { name: "南六", changePct: 9.9 },
      ],
    });
    expect(digest.topGainers).toHaveLength(10);
    expect(digest.topLosers?.[0]?.name).toBe("矽晶圓");
    expect(digest.topLosers).toHaveLength(10);
  });

  it("reads the net buy and sell flow tables", () => {
    expect(digest.netBuy?.[0]).toEqual({
      name: "被動元件",
      netFlow: 57.44,
      prevNetFlow: 286.83,
      turnover: 922.3,
      marketSharePct: 8.95,
      concentration: 0.99,
      changePct: 2.58,
    });
    expect(digest.netSell?.[0]?.name).toBe("軸承／滑軌");
    expect(digest.netSell?.[0]?.netFlow).toBe(-104.13);
  });

  it("reads the quadrant counts, transitions and leaders", () => {
    expect(digest.quadrant?.counts.today).toEqual({ 強勢: 43, 弱勢: 78, 轉強: 25, 轉弱: 29 });
    expect(digest.quadrant?.counts.prev).toEqual({ 強勢: 45, 弱勢: 82, 轉強: 24, 轉弱: 24 });
    expect(digest.quadrant?.transitions).toHaveLength(15);
    expect(digest.quadrant?.transitions[0]).toEqual({
      name: "車用電子",
      from: "強勢",
      to: "轉弱",
      slope5d: -27.59,
      slope20d: 13.12,
      netFlowToday: -77.58,
    });
    expect(digest.quadrant?.leaders).toHaveLength(4);
    expect(digest.quadrant?.leaders[0]?.label).toBe("近 5 日流入最強");
    expect(digest.quadrant?.leaders[0]?.entries).toHaveLength(5);
    expect(digest.quadrant?.leaders[0]?.entries[0]).toEqual({
      name: "印刷電路板上游與材料",
      slope5d: 111.3,
      slope20d: 21.4,
      quadrant: "強勢",
    });
  });

  it("keeps the limit-up/down summary and sub-tables", () => {
    expect(digest.limits?.summary).toHaveLength(2);
    expect(digest.limits?.tables.map((t) => t.heading.slice(0, 4))).toEqual([
      "漲停鎖死",
      "曾鎖死、",
      "跌停鎖死",
    ]);
    expect(digest.limits?.tables[0]?.tables[0]?.rows).toHaveLength(33);
  });

  it("reads the glossary and caveats", () => {
    expect(digest.glossary.length).toBeGreaterThanOrEqual(9);
    expect(digest.glossary.find((g) => g.term === "力度")?.definition).toMatch(/^全部族群/);
    expect(digest.caveats.join("")).toContain("請勿據此推論明日走勢");
  });

  it("yields null for optional sections that are absent", () => {
    let partial = removeSection(html, "資金趨勢四象限");
    partial = removeSection(partial, "漲跌停");
    partial = removeSection(partial, "資金：");
    const result = parseDigest(partial);
    expect(result.quadrant).toBeNull();
    expect(result.limits).toBeNull();
    expect(result.netBuy).toBeNull();
    expect(result.netSell).toBeNull();
    expect(result.topGainers).not.toBeNull();
    expect(result.market.upGroups).toBe(87);
  });

  it("throws a DarkfanxingParseError naming 大盤 when it is missing", () => {
    const withoutMarket = removeSection(html, "大盤");
    expect(() => parseDigest(withoutMarket)).toThrow(DarkfanxingParseError);
    try {
      parseDigest(withoutMarket);
    } catch (error) {
      expect(error).toBeInstanceOf(DarkfanxingParseError);
      expect((error as DarkfanxingParseError).section).toBe("大盤");
      expect((error as DarkfanxingParseError).message).toContain("大盤");
    }
  });

  it("throws rather than nulling an optional section that is malformed", () => {
    const malformed = html.replace("<th>內外盤金額差(億)</th>", "<th>淨額</th>");
    expect(() => parseDigest(malformed)).toThrow(DarkfanxingParseError);
  });
});
