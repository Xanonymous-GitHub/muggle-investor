import { describe, expect, expectTypeOf, it } from "vitest";
import {
  briefingLatestUrl,
  glossaryUrl,
  type Jsonify,
  recapUrl,
  sectorDetailUrl,
  sectorsUrl,
  todayUrl,
} from "@/ui/data/api";

describe("api urls", () => {
  it("builds the fixed routes", () => {
    expect(todayUrl()).toBe("/api/market/today");
    expect(sectorsUrl()).toBe("/api/market/sectors");
    expect(glossaryUrl()).toBe("/api/glossary");
  });

  it("puts the lens and since into the query", () => {
    expect(briefingLatestUrl("beginner")).toBe("/api/briefings/latest?lens=beginner");
    expect(briefingLatestUrl("pro")).toBe("/api/briefings/latest?lens=pro");
    expect(recapUrl("2026-10-08")).toBe("/api/market/recap?since=2026-10-08");
  });

  it("percent-encodes a sector name, full-width slash included", () => {
    expect(sectorDetailUrl("軸承／滑軌")).toBe(
      "/api/market/sectors/%E8%BB%B8%E6%89%BF%EF%BC%8F%E6%BB%91%E8%BB%8C",
    );
    expect(sectorDetailUrl("a/b")).toBe("/api/market/sectors/a%2Fb");
  });
});

describe("Jsonify", () => {
  it("turns dates into strings, recursively", () => {
    type In = { at: Date; list: { when: Date; n: number }[]; maybe: Date | null };
    expectTypeOf<Jsonify<In>>().toEqualTypeOf<{
      at: string;
      list: { when: string; n: number }[];
      maybe: string | null;
    }>();
  });
});
