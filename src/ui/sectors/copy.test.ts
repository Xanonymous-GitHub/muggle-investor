import { describe, expect, it } from "vitest";
import type { SectorRow } from "@/sources/darkfanxing/schemas";
import {
  FLOW_NOTE,
  plainChangeLine,
  plainFlowLine,
  QUADRANT_TRANSITIONS_TITLE,
  SECTOR_HELP_BODY,
  SECTOR_HELP_TITLE,
  VIEW_LABELS,
} from "@/ui/sectors/copy";

const row = (over: Partial<SectorRow>): SectorRow => ({
  rank: 1,
  name: "被動元件",
  changePct: 0,
  advancers: 0,
  decliners: 0,
  unchanged: 0,
  constituents: 20,
  turnover: 100,
  turnoverRank: 1,
  turnoverVsPrevPct: null,
  limitUp: 0,
  limitDown: 0,
  change1mPct: null,
  ...over,
});

describe("plainChangeLine", () => {
  it("describes a rising sector with limit-ups", () => {
    const line = plainChangeLine(
      row({ changePct: 2.5, constituents: 20, advancers: 14, decliners: 5, limitUp: 2 }),
    );
    expect(line).toBe("今天上漲，20 家公司裡有 14 家上漲、5 家下跌，2 家漲停。");
  });

  it("describes a falling sector with limit-downs", () => {
    const line = plainChangeLine(
      row({ changePct: -1.2, constituents: 10, advancers: 2, decliners: 7, limitDown: 1 }),
    );
    expect(line).toBe("今天下跌，10 家公司裡有 2 家上漲、7 家下跌，1 家跌停。");
  });

  it("describes a flat sector without limit mentions", () => {
    const line = plainChangeLine(
      row({ changePct: 0, constituents: 8, advancers: 3, decliners: 3 }),
    );
    expect(line).toBe("今天持平，8 家公司裡有 3 家上漲、3 家下跌。");
  });
});

describe("plainFlowLine", () => {
  it("says active buyers outweighed sellers for a positive figure", () => {
    expect(plainFlowLine(57.44)).toBe("今天急著買的金額比急著賣的多約 57.44 億元。");
  });

  it("says active sellers outweighed buyers for a negative figure", () => {
    expect(plainFlowLine(-104.13)).toBe("今天急著賣的金額比急著買的多約 104.13 億元。");
  });

  it("says the two are about equal at zero", () => {
    expect(plainFlowLine(0)).toBe("今天急著買與急著賣的金額差不多。");
  });

  it("treats a figure that rounds to 0.00 as equal", () => {
    expect(plainFlowLine(0.004)).toBe("今天急著買與急著賣的金額差不多。");
    expect(plainFlowLine(-0.004)).toBe("今天急著買與急著賣的金額差不多。");
  });
});

describe("fixed wording", () => {
  it("labels the three views for each lens", () => {
    expect(VIEW_LABELS.beginner).toEqual({
      change: "今天誰漲誰跌",
      flow: "錢跑去哪裡",
      quadrant: "誰在變強變弱",
    });
    expect(VIEW_LABELS.pro).toEqual({ change: "漲跌幅", flow: "內外盤金額差", quadrant: "四象限" });
  });

  it("keeps the help and note strings", () => {
    expect(SECTOR_HELP_TITLE).toBe("什麼是族群？");
    expect(SECTOR_HELP_BODY).toContain("被動元件");
    expect(FLOW_NOTE).toBe("只列出前十名流入與前十名流出");
    expect(QUADRANT_TRANSITIONS_TITLE).toBe("今天換象限");
  });
});
