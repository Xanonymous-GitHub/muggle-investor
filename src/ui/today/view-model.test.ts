import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DigestSnapshot, parseDigest } from "@/sources/darkfanxing";
import type { BriefingJson } from "@/ui/data/api";
import {
  breadthBar,
  briefingState,
  FLOW_ROWS,
  flowRows,
  MOVER_ROWS,
  moverRows,
  todayTiles,
} from "@/ui/today/view-model";

const fixtures = join(import.meta.dirname, "../../../test/fixtures/darkfanxing");
const digest = parseDigest(readFileSync(join(fixtures, "digest-2026-10-08.html"), "utf8"));

const briefing = (periodKey: string): BriefingJson => ({
  briefing: {
    kind: "daily",
    periodKey,
    lens: "beginner",
    promptVersion: 1,
    model: "test",
    createdAt: "2026-10-08T10:00:00.000Z",
    content: {
      headline: `${periodKey} 標題`,
      summary: "一句話摘要。",
      sections: [
        { title: "大盤", body: "大盤內容" },
        { title: "資金", body: "資金內容" },
      ],
      takeaway: "重點",
      termIds: ["futures"],
    },
  },
  terms: {},
});

describe("breadthBar", () => {
  it("splits the up and down groups", () => {
    expect(breadthBar(digest.market)).toEqual({ up: 87, down: 88, upPct: 49.7 });
  });

  it("is null when there are no groups at all", () => {
    expect(breadthBar({ ...digest.market, upGroups: 0, downGroups: 0 })).toBeNull();
  });
});

describe("todayTiles", () => {
  it("shows the futures and group tiles in the beginner lens", () => {
    const tiles = todayTiles(digest, "beginner");
    expect(tiles.map((t) => t.label)).toEqual(["台指期收盤", "漲跌", "漲跌幅", "漲／跌族群"]);
    expect(tiles.map((t) => t.value)).toEqual(["49,349", "-619 點", "-1.24%", "87 / 88"]);
    expect(tiles.map((t) => t.trend)).toEqual(["flat", "down", "down", "flat"]);
  });

  it("adds force and breadth in the pro lens", () => {
    const tiles = todayTiles(digest, "pro");
    expect(tiles.slice(4).map((t) => `${t.label} ${t.value}`)).toEqual([
      "力度 -0.63%",
      "面積 +0.20%",
    ]);
    expect(tiles.slice(4).map((t) => t.trend)).toEqual(["down", "up"]);
  });

  it("drops the futures tiles when there is no futures quote", () => {
    const noFutures: DigestSnapshot = { ...digest, market: { ...digest.market, futures: null } };
    for (const lens of ["beginner", "pro"] as const) {
      const tiles = todayTiles(noFutures, lens);
      expect(tiles.map((t) => t.label)).not.toContain("台指期收盤");
      expect(tiles.map((t) => t.label)).not.toContain("漲跌");
      expect(tiles.map((t) => t.label)).not.toContain("漲跌幅");
      expect(JSON.stringify(tiles)).not.toMatch(/NaN|undefined/);
    }
    expect(todayTiles(noFutures, "beginner").map((t) => t.label)).toEqual(["漲／跌族群"]);
  });

  it("gives every tile a unique id", () => {
    const ids = todayTiles(digest, "pro").map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("briefingState", () => {
  it("is current when the briefing covers the digest's day", () => {
    const state = briefingState("2026-10-08", briefing("2026-10-08"));
    expect(state).toEqual({
      kind: "current",
      headline: "2026-10-08 標題",
      summary: "一句話摘要。",
      sections: [
        { title: "大盤", body: "大盤內容" },
        { title: "資金", body: "資金內容" },
      ],
      takeaway: "重點",
      termIds: ["futures"],
      periodKey: "2026-10-08",
    });
  });

  it("is older when the briefing predates the digest", () => {
    expect(briefingState("2026-10-08", briefing("2026-10-07"))).toEqual({
      kind: "older",
      headline: "2026-10-07 標題",
      periodKey: "2026-10-07",
    });
  });

  it("is pending when there is no briefing", () => {
    expect(briefingState("2026-10-08", null)).toEqual({ kind: "pending" });
  });
});

describe("moverRows", () => {
  it("is empty for a missing list", () => {
    expect(moverRows(null)).toEqual([]);
  });

  it("takes the first rows with signed percentages", () => {
    const rows = moverRows(digest.topGainers);
    expect(rows).toHaveLength(MOVER_ROWS);
    expect(rows[0]).toEqual({ name: "不織布", value: "+5.97%", trend: "up" });
    expect(moverRows(digest.topLosers, 2)).toEqual([
      { name: "矽晶圓", value: "-3.36%", trend: "down" },
      { name: "軸承／滑軌", value: "-2.94%", trend: "down" },
    ]);
  });

  it("leaves a flat row neutral", () => {
    expect(moverRows([{ name: "持平", changePct: 0 }])).toEqual([
      { name: "持平", value: "0.00%", trend: "flat" },
    ]);
    // Rounds to zero on screen, so it is not coloured either.
    expect(moverRows([{ name: "微漲", changePct: 0.001 }])[0]?.trend).toBe("flat");
  });
});

describe("flowRows", () => {
  it("is empty for a missing list", () => {
    expect(flowRows(null)).toEqual([]);
  });

  it("formats net flow in 億 with a sign", () => {
    expect(flowRows(digest.netBuy)).toHaveLength(FLOW_ROWS);
    expect(flowRows(digest.netBuy, 1)).toEqual([
      { name: "被動元件", value: "+57.44 億", trend: "up" },
    ]);
    expect(flowRows(digest.netSell, 1)).toEqual([
      { name: "軸承／滑軌", value: "-104.13 億", trend: "down" },
    ]);
  });
});
