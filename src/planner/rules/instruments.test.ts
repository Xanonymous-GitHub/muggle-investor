import { describe, expect, it } from "vitest";
import { CATEGORY_MEMBERS, ELIGIBILITY } from "./instruments";

describe("CATEGORY_MEMBERS", () => {
  it("lists the signed-off initial members", () => {
    expect(CATEGORY_MEMBERS.core).toEqual(["0050", "006208", "0051", "006203", "00922"]);
    expect(CATEGORY_MEMBERS.bond).toEqual([
      "00679B",
      "00687B",
      "00696B",
      "00720B",
      "00725B",
      "00751B",
      "00772B",
    ]);
    expect(CATEGORY_MEMBERS.dividend).toEqual([
      "0056",
      "00878",
      "00919",
      "00713",
      "00929",
      "00940",
      "00900",
      "00915",
      "00731",
    ]);
  });

  it("has no symbol in two categories or twice in one", () => {
    const all = Object.values(CATEGORY_MEMBERS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("ELIGIBILITY", () => {
  it("holds the signed-off thresholds", () => {
    expect(ELIGIBILITY.maxStaleDays).toBe(10);
    expect(ELIGIBILITY.minHistoryYears).toEqual({ core: 5, dividend: 5, bond: 3 });
    expect(ELIGIBILITY.minMedianTurnover).toBe(100_000_000);
    expect(ELIGIBILITY.recentDays).toBe(120);
  });

  it("excludes leveraged, inverse, futures, currency and commodity names", () => {
    for (const name of [
      "元大台灣50正2",
      "元大台灣50反1",
      "某某槓桿ETF",
      "某某反向ETF",
      "某某期貨ETF",
      "美元計價債",
      "某某人民幣貨幣",
      "國泰RMB短期報酬",
      "某某黃金ETF",
      "某某原油ETF",
      "元大S&P石油",
      "期元大S&P石油",
      "期街口S&P黃豆",
      "期元大道瓊白銀",
      "期街口道瓊銅",
      "富邦上証+R",
      "群益深証中小+R",
      "新光中政金綠債+R",
      "某某ETN",
      "富邦VIX",
      "某某比特幣",
      "某某虛擬貨幣",
    ]) {
      expect(ELIGIBILITY.excludedNamePattern.test(name), name).toBe(true);
    }
    // 期 only as a prefix: 短期 in a bond name is not a futures marker.
    for (const name of ["元大台灣50", "元大高股息", "元大美債20年", "國泰US短期公債"]) {
      expect(ELIGIBILITY.excludedNamePattern.test(name), name).toBe(false);
    }
  });

  it("excludes leveraged (L), inverse (R) and futures (U) symbols", () => {
    for (const symbol of ["00631L", "00632R", "00635U"]) {
      expect(ELIGIBILITY.excludedSymbolPattern.test(symbol), symbol).toBe(true);
    }
    for (const symbol of ["0050", "00679B", "00687B", "00625K"]) {
      expect(ELIGIBILITY.excludedSymbolPattern.test(symbol), symbol).toBe(false);
    }
  });

  it("excludes none of the 21 curated members by name or symbol", () => {
    // Names as FinMind lists them (TaiwanStockInfo, 2026-10).
    const names: Record<string, string> = {
      "0050": "元大台灣50",
      "006208": "富邦台50",
      "0051": "元大中型100",
      "006203": "元大MSCI台灣",
      "00922": "國泰台灣領袖50",
      "00679B": "元大美債20年",
      "00687B": "國泰20年美債",
      "00696B": "富邦美債20年",
      "00720B": "元大投資級公司債",
      "00725B": "國泰投資級公司債",
      "00751B": "元大AAA至A公司債",
      "00772B": "中信高評級公司債",
      "0056": "元大高股息",
      "00878": "國泰永續高股息",
      "00919": "群益台灣精選高息",
      "00713": "元大台灣高息低波",
      "00929": "復華台灣科技優息",
      "00940": "元大台灣價值高息",
      "00900": "富邦特選高股息30",
      "00915": "凱基優選高股息30",
      "00731": "復華富時高息低波",
    };
    const members = Object.values(CATEGORY_MEMBERS).flat();
    expect(members).toHaveLength(21);
    for (const symbol of members) {
      expect(ELIGIBILITY.excludedSymbolPattern.test(symbol), symbol).toBe(false);
      expect(ELIGIBILITY.excludedNamePattern.test(names[symbol] ?? ""), symbol).toBe(false);
    }
  });
});
