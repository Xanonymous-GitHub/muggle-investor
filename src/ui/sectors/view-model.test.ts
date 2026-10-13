import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDigest, type SectorRow } from "@/sources/darkfanxing";
import { filterSectors, quadrantSummary, sortSectors } from "@/ui/sectors/view-model";

const fixtures = join(import.meta.dirname, "../../../test/fixtures/darkfanxing");
const digest = parseDigest(readFileSync(join(fixtures, "digest-2026-10-08.html"), "utf8"));

const row = (name: string, over: Partial<SectorRow> = {}): SectorRow => ({
  rank: 1,
  name,
  changePct: 0,
  advancers: 0,
  decliners: 0,
  unchanged: 0,
  constituents: 10,
  turnover: 100,
  turnoverRank: 1,
  turnoverVsPrevPct: null,
  limitUp: 0,
  limitDown: 0,
  change1mPct: null,
  ...over,
});

const board: SectorRow[] = [
  row("被動元件", { changePct: 1.5, advancers: 8, turnover: 300, change1mPct: 4 }),
  row("MCU", { changePct: -0.5, advancers: 2, turnover: 120, change1mPct: null }),
  row("光通訊", { changePct: 1.5, advancers: 6, turnover: 250, change1mPct: -2 }),
  row("矽晶圓", { changePct: -3, advancers: 1, turnover: 400, change1mPct: null }),
  row("被動元件上游", { changePct: 0, advancers: 4, turnover: 90, change1mPct: 1 }),
];

const names = (rows: SectorRow[]) => rows.map((r) => r.name);

describe("filterSectors", () => {
  it("matches by substring", () => {
    expect(names(filterSectors(board, "被動"))).toEqual(["被動元件", "被動元件上游"]);
  });

  it("ignores case and surrounding spaces", () => {
    expect(names(filterSectors(board, "  mcu "))).toEqual(["MCU"]);
  });

  it("returns every row for an empty or blank query", () => {
    expect(filterSectors(board, "")).toEqual(board);
    expect(filterSectors(board, "   ")).toEqual(board);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterSectors(board, "不存在")).toEqual([]);
  });
});

describe("sortSectors", () => {
  it("sorts by changePct descending and keeps ties in input order", () => {
    expect(names(sortSectors(board, "changePct", "desc"))).toEqual([
      "被動元件",
      "光通訊",
      "被動元件上游",
      "MCU",
      "矽晶圓",
    ]);
  });

  it("sorts by changePct ascending and keeps ties in input order", () => {
    expect(names(sortSectors(board, "changePct", "asc"))).toEqual([
      "矽晶圓",
      "MCU",
      "被動元件上游",
      "被動元件",
      "光通訊",
    ]);
  });

  it("sorts by advancers and turnover", () => {
    expect(names(sortSectors(board, "advancers", "desc"))[0]).toBe("被動元件");
    expect(names(sortSectors(board, "turnover", "asc"))[0]).toBe("被動元件上游");
  });

  it("puts a missing change1mPct last in both directions", () => {
    expect(names(sortSectors(board, "change1mPct", "desc"))).toEqual([
      "被動元件",
      "被動元件上游",
      "光通訊",
      "MCU",
      "矽晶圓",
    ]);
    expect(names(sortSectors(board, "change1mPct", "asc"))).toEqual([
      "光通訊",
      "被動元件上游",
      "被動元件",
      "MCU",
      "矽晶圓",
    ]);
  });

  it("sorts names ascending with the zh-Hant collation", () => {
    const expected = [...board.map((r) => r.name)].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    expect(names(sortSectors(board, "name", "asc"))).toEqual(expected);
    expect(names(sortSectors(board, "name", "desc"))).toEqual([...expected].reverse());
  });

  it("does not mutate its input", () => {
    const copy = [...board];
    sortSectors(board, "changePct", "asc");
    expect(board).toEqual(copy);
  });
});

describe("quadrantSummary", () => {
  const q = digest.quadrant;
  if (!q) throw new Error("fixture digest has no quadrant section");
  const summary = quadrantSummary(q);

  it("lists the four counts in the fixed order with the previous day", () => {
    expect(summary.counts).toEqual([
      { label: "強勢", today: 43, prev: 45 },
      { label: "轉強", today: 25, prev: 24 },
      { label: "轉弱", today: 29, prev: 24 },
      { label: "弱勢", today: 78, prev: 82 },
    ]);
  });

  it("uses null for prev when the previous counts are missing", () => {
    const noPrev = quadrantSummary({ ...q, counts: { ...q.counts, prev: null } });
    expect(noPrev.counts.map((c) => c.prev)).toEqual([null, null, null, null]);
    expect(noPrev.counts.map((c) => c.today)).toEqual([43, 25, 29, 78]);
  });

  it("keeps the transitions with name, from and to only", () => {
    expect(summary.transitions).toHaveLength(15);
    expect(summary.transitions).toContainEqual({ name: "車用電子", from: "強勢", to: "轉弱" });
    expect(summary.transitions[0]).toEqual({ name: "車用電子", from: "強勢", to: "轉弱" });
  });

  it("flattens the leaders to labels and names", () => {
    expect(summary.leaders).toHaveLength(4);
    expect(summary.leaders[0]).toEqual({
      label: "近 5 日流入最強",
      names: ["印刷電路板上游與材料", "印刷電路板", "被動元件", "玻纖布", "銅箔基板"],
    });
  });
});
