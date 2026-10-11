import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSection, parseReportDocument } from "./report-document";

const fixture = (name: string) => readFileSync(`test/fixtures/darkfanxing/${name}`, "utf8");

describe("parseReportDocument", () => {
  const digest = parseReportDocument(fixture("digest-2026-10-08.html"));

  it("reads the digest title and sections", () => {
    expect(digest.title).toBe("台股盤面摘要 2026-10-08（收盤後）");
    expect(digest.sections).toHaveLength(12);
    expect(digest.sections.filter((s) => s.level === 2)).toHaveLength(9);
    expect(digest.sections.filter((s) => s.level === 3)).toHaveLength(3);
    expect(digest.intro.length).toBeGreaterThan(0);
    expect(digest.introTables).toEqual([]);
    expect(digest.text).toContain("盤中節奏");
  });

  it("parses the intraday table", () => {
    const table = findSection(digest, "盤中節奏")?.tables[0];
    expect(table?.headers).toEqual([
      "時間",
      "上漲/下跌族群",
      "力度%",
      "面積%",
      "當時領漲",
      "當時領跌",
    ]);
    expect(table?.rows).toHaveLength(6);
  });

  it("keeps list items and heading levels", () => {
    expect(findSection(digest, "大盤")?.items).toHaveLength(3);
    expect(findSection(digest, "漲停鎖死中")?.level).toBe(3);
    expect(findSection(digest, "不存在")).toBeUndefined();
  });

  it("puts tables before the first heading into introTables (now)", () => {
    const doc = parseReportDocument(fixture("now-2026-10-08.html"));
    expect(doc.sections).toHaveLength(0);
    expect(doc.introTables).toHaveLength(1);
    expect(doc.introTables[0]?.rows).toHaveLength(175);
    expect(doc.introTables[0]?.headers).toHaveLength(11);
  });

  it("keeps empty cells (group)", () => {
    const doc = parseReportDocument(fixture("group-quartz-2026-10-08.html"));
    expect(doc.sections).toHaveLength(0);
    const table = doc.introTables[0];
    expect(table?.rows).toHaveLength(5);
    expect(table?.rows[0]).toEqual(["安碁 6174", "+9.97", "6.37", "+90.4", "+59.0", ""]);
  });
});
