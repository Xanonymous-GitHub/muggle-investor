import { describe, expect, it } from "vitest";
import { getTerm } from "@/glossary";
import { briefingContentSchema } from "./briefing-content";
import { LENSES } from "./lens";
import { buildSampleBriefing } from "./sample-briefing";

describe("buildSampleBriefing", () => {
  it.each(LENSES)("passes briefingContentSchema for %s", (lens) => {
    expect(briefingContentSchema.safeParse(buildSampleBriefing(lens, "2026-10-08")).success).toBe(
      true,
    );
  });

  it.each(LENSES)("labels every text field as a sample for %s", (lens) => {
    const content = buildSampleBriefing(lens, "2026-10-08");
    expect(content.headline.startsWith("【範例】")).toBe(true);
    expect(content.summary.startsWith("【範例】")).toBe(true);
    expect(content.takeaway.startsWith("【範例】")).toBe(true);
  });

  it("has distinct text per lens", () => {
    const beginner = buildSampleBriefing("beginner", "2026-10-08");
    const pro = buildSampleBriefing("pro", "2026-10-08");
    expect(beginner.headline).not.toBe(pro.headline);
    expect(beginner.summary).not.toBe(pro.summary);
    expect(beginner.sections).not.toEqual(pro.sections);
  });

  it("names the trade date in the summary", () => {
    expect(buildSampleBriefing("pro", "2026-10-08").summary).toContain("2026-10-08");
  });

  it.each(LENSES)("cites only existing glossary terms for %s", (lens) => {
    for (const id of buildSampleBriefing(lens, "2026-10-08").termIds) {
      expect(getTerm(id)).toBeDefined();
    }
  });
});
