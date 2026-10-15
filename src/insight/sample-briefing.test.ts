import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { getPlanExplanation, savePlanExplanation } from "@/db/repositories/plan-explanations";
import { getTerm } from "@/glossary";
import { ALLOCATION_TABLE } from "@/planner/rules/allocation";
import type { RiskLevel } from "@/planner/rules/questionnaire";
import { createTestDb } from "../../test/helpers/test-db";
import { type BriefingContent, briefingContentSchema } from "./briefing-content";
import { LENSES } from "./lens";
import { PLAN_PROMPT_TERMS } from "./prompts/shared";
import {
  buildSampleBriefing,
  buildSamplePlanExplanation,
  SAMPLE_PLAN_FINGERPRINT,
  SAMPLE_PREFIX,
  seedSamplePlanExplanations,
} from "./sample-briefing";

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

const LEVELS: RiskLevel[] = [1, 2, 3, 4, 5];
const combos = LEVELS.flatMap((level) => LENSES.map((lens) => [level, lens] as const));

const textFields = (content: BriefingContent): string[] => [
  content.headline,
  content.summary,
  content.takeaway,
  ...content.sections.flatMap((section) => [section.title, section.body]),
];

describe("buildSamplePlanExplanation", () => {
  it.each(combos)("passes briefingContentSchema for level %i, %s", (level, lens) => {
    expect(briefingContentSchema.safeParse(buildSamplePlanExplanation(level, lens)).success).toBe(
      true,
    );
  });

  it.each(combos)(
    "starts every text field with the sample prefix (level %i, %s)",
    (level, lens) => {
      for (const text of textFields(buildSamplePlanExplanation(level, lens))) {
        expect(text.startsWith(SAMPLE_PREFIX)).toBe(true);
      }
    },
  );

  it.each(combos)(
    "quotes only the level's allocation percentages (level %i, %s)",
    (level, lens) => {
      const text = textFields(buildSamplePlanExplanation(level, lens)).join("\n");
      const row = Object.values(ALLOCATION_TABLE[level]);
      // Every number is a percentage taken from the table row, and no other digits appear.
      const numbers = text.match(/\d+(?:\.\d+)?%?/g) ?? [];
      expect(numbers.length).toBeGreaterThan(0);
      for (const quoted of numbers) {
        expect(quoted.endsWith("%")).toBe(true);
        expect(row).toContain(Number.parseFloat(quoted));
      }
      // Every held slice is quoted.
      for (const weight of row.filter((w) => w > 0)) expect(text).toContain(`${weight}%`);
    },
  );

  it.each(combos)("cites only plan glossary terms (level %i, %s)", (level, lens) => {
    const planIds = PLAN_PROMPT_TERMS.map((term) => term.id);
    for (const id of buildSamplePlanExplanation(level, lens).termIds) {
      expect(planIds).toContain(id);
      expect(getTerm(id)).toBeDefined();
    }
  });

  it("differs by level and by lens", () => {
    expect(buildSamplePlanExplanation(1, "beginner")).not.toEqual(
      buildSamplePlanExplanation(5, "beginner"),
    );
    expect(buildSamplePlanExplanation(3, "beginner")).not.toEqual(
      buildSamplePlanExplanation(3, "pro"),
    );
  });
});

describe("seedSamplePlanExplanations", () => {
  let db: Db;
  // 2026-10-15 in Taipei is ISO week 2026-W42.
  const NOW = new Date("2026-10-15T04:00:00Z");

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("stores the ten samples for the current Taipei week at version 0", async () => {
    expect(await seedSamplePlanExplanations(db, NOW)).toEqual({ saved: 10, total: 10 });
    for (const [level, lens] of combos) {
      const row = await getPlanExplanation(db, level, lens);
      expect(row).toMatchObject({
        periodKey: "2026-W42",
        promptVersion: 0,
        model: "sample",
        factsFingerprint: SAMPLE_PLAN_FINGERPRINT,
        content: buildSamplePlanExplanation(level, lens),
      });
    }
  });

  it("uses the Taipei date for the week, not the UTC date", async () => {
    // Sunday 2026-10-18 23:30 UTC is Monday 2026-10-19 07:30 in Taipei: the next ISO week.
    const result = await seedSamplePlanExplanations(db, new Date("2026-10-18T23:30:00Z"));
    expect(result.saved).toBe(10);
    expect((await getPlanExplanation(db, 3, "pro"))?.periodKey).toBe("2026-W43");
  });

  it("is idempotent within a week", async () => {
    await seedSamplePlanExplanations(db, NOW);
    expect(await seedSamplePlanExplanations(db, NOW)).toEqual({ saved: 0, total: 10 });
  });

  it("is replaced by a real row (version 1), even in the same week", async () => {
    await seedSamplePlanExplanations(db, NOW);
    const real = {
      ...buildSamplePlanExplanation(3, "beginner"),
      headline: "平衡配置的說明",
    };
    const result = await savePlanExplanation(db, {
      level: 3,
      lens: "beginner",
      periodKey: "2026-W42",
      promptVersion: 1,
      model: "real-model",
      content: real,
      factsFingerprint: "real-fingerprint",
    });
    expect(result).toEqual({ saved: true });
    expect((await getPlanExplanation(db, 3, "beginner"))?.content.headline).toBe("平衡配置的說明");
  });

  it("never overwrites a real row", async () => {
    await savePlanExplanation(db, {
      level: 3,
      lens: "beginner",
      periodKey: "2026-W42",
      promptVersion: 1,
      model: "real-model",
      content: { ...buildSamplePlanExplanation(3, "beginner"), headline: "平衡配置的說明" },
      factsFingerprint: "real-fingerprint",
    });
    expect(await seedSamplePlanExplanations(db, NOW)).toEqual({ saved: 9, total: 10 });
    expect((await getPlanExplanation(db, 3, "beginner"))?.model).toBe("real-model");
  });
});
