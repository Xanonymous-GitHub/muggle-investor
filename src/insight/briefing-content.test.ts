import { describe, expect, it } from "vitest";
import { briefingContentSchema } from "./briefing-content";

const section = { title: "大盤", body: "今天加權指數小幅上漲。" };
function valid() {
  return {
    headline: "指數小漲",
    summary: "加權指數收漲，成交量持平。",
    sections: [section, { ...section, title: "類股" }],
    takeaway: "這是教育資訊，不是投資建議。",
    termIds: ["twii"],
  };
}

describe("briefingContentSchema", () => {
  it("accepts a valid object", () => {
    expect(briefingContentSchema.safeParse(valid()).success).toBe(true);
  });

  it("rejects an empty headline", () => {
    expect(briefingContentSchema.safeParse({ ...valid(), headline: "" }).success).toBe(false);
  });

  it("accepts a 40-char headline and rejects a 41-char one", () => {
    expect(briefingContentSchema.safeParse({ ...valid(), headline: "a".repeat(40) }).success).toBe(
      true,
    );
    expect(briefingContentSchema.safeParse({ ...valid(), headline: "a".repeat(41) }).success).toBe(
      false,
    );
  });

  it("rejects 1 section and 5 sections, accepts 2 and 4", () => {
    const withSections = (n: number) => ({
      ...valid(),
      sections: Array.from({ length: n }, () => section),
    });
    expect(briefingContentSchema.safeParse(withSections(1)).success).toBe(false);
    expect(briefingContentSchema.safeParse(withSections(5)).success).toBe(false);
    expect(briefingContentSchema.safeParse(withSections(2)).success).toBe(true);
    expect(briefingContentSchema.safeParse(withSections(4)).success).toBe(true);
  });

  it("rejects over-long summary, section title/body and takeaway", () => {
    expect(briefingContentSchema.safeParse({ ...valid(), summary: "a".repeat(121) }).success).toBe(
      false,
    );
    expect(briefingContentSchema.safeParse({ ...valid(), takeaway: "a".repeat(161) }).success).toBe(
      false,
    );
    const bad = (s: object) => ({ ...valid(), sections: [section, { ...section, ...s }] });
    expect(briefingContentSchema.safeParse(bad({ title: "a".repeat(25) })).success).toBe(false);
    expect(briefingContentSchema.safeParse(bad({ body: "a".repeat(601) })).success).toBe(false);
  });
});
