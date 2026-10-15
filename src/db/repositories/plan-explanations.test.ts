import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import type { BriefingContent } from "@/insight/briefing-content";
import { createTestDb } from "../../../test/helpers/test-db";
import { planExplanations } from "../schema";
import {
  deleteStalePlanExplanation,
  getPlanExplanation,
  hasPlanExplanation,
  type PlanExplanation,
  PlanExplanationDriftError,
  savePlanExplanation,
} from "./plan-explanations";

function content(headline = "穩健配置說明"): BriefingContent {
  return {
    headline,
    summary: "這份配置以債券為主。",
    sections: [
      { title: "為什麼", body: "債券波動較小。" },
      { title: "風險", body: "股票部位仍可能下跌。" },
    ],
    takeaway: "這是教育資訊，不是投資建議。",
    termIds: ["twii"],
  };
}

function explanation(overrides: Partial<Omit<PlanExplanation, "createdAt">> = {}) {
  return {
    level: 3 as const,
    lens: "beginner" as const,
    periodKey: "2026-W41",
    promptVersion: 1,
    model: "test-model",
    content: content(),
    factsFingerprint: "fp-a",
    ...overrides,
  };
}

describe("plan explanations repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("round-trips a saved explanation", async () => {
    const createdAt = new Date("2026-10-08T07:00:00Z");
    expect(await savePlanExplanation(db, { ...explanation(), createdAt })).toEqual({ saved: true });
    expect(await getPlanExplanation(db, 3, "beginner")).toEqual({ ...explanation(), createdAt });
  });

  it("returns null for a missing explanation and keeps level and lens separate", async () => {
    await savePlanExplanation(db, explanation());
    expect(await getPlanExplanation(db, 3, "pro")).toBeNull();
    expect(await getPlanExplanation(db, 4, "beginner")).toBeNull();
  });

  it("ignores a save with the same version and the same or an older week", async () => {
    await savePlanExplanation(db, explanation());
    expect(await savePlanExplanation(db, explanation({ content: content("同週") }))).toEqual({
      saved: false,
    });
    expect(
      await savePlanExplanation(
        db,
        explanation({ periodKey: "2026-W40", content: content("舊週") }),
      ),
    ).toEqual({ saved: false });
    const got = await getPlanExplanation(db, 3, "beginner");
    expect(got?.content.headline).toBe("穩健配置說明");
    expect(got?.periodKey).toBe("2026-W41");
  });

  it("replaces on the same version with a later week", async () => {
    await savePlanExplanation(db, explanation());
    expect(
      await savePlanExplanation(
        db,
        explanation({ periodKey: "2026-W42", content: content("新週") }),
      ),
    ).toEqual({ saved: true });
    const got = await getPlanExplanation(db, 3, "beginner");
    expect(got).toMatchObject({ periodKey: "2026-W42", promptVersion: 1 });
    expect(got?.content.headline).toBe("新週");
    expect(await db.select().from(planExplanations)).toHaveLength(1);
  });

  it("replaces on the same version and week only when the fingerprint differs", async () => {
    await savePlanExplanation(db, explanation());
    expect(await savePlanExplanation(db, explanation({ content: content("同指紋") }))).toEqual({
      saved: false,
    });
    expect(
      await savePlanExplanation(
        db,
        explanation({ factsFingerprint: "fp-b", content: content("新指紋") }),
      ),
    ).toEqual({ saved: true });
    expect(await getPlanExplanation(db, 3, "beginner")).toMatchObject({
      periodKey: "2026-W41",
      factsFingerprint: "fp-b",
      content: { headline: "新指紋" },
    });
  });

  it("never replaces from an older week, even with a different fingerprint", async () => {
    await savePlanExplanation(db, explanation());
    expect(
      await savePlanExplanation(
        db,
        explanation({ periodKey: "2026-W40", factsFingerprint: "fp-b" }),
      ),
    ).toEqual({ saved: false });
    expect(await getPlanExplanation(db, 3, "beginner")).toMatchObject({ factsFingerprint: "fp-a" });
  });

  it("replaces on a later week with the same fingerprint", async () => {
    await savePlanExplanation(db, explanation());
    expect(await savePlanExplanation(db, explanation({ periodKey: "2026-W42" }))).toEqual({
      saved: true,
    });
  });

  it("orders weeks across a year boundary", async () => {
    await savePlanExplanation(db, explanation({ periodKey: "2026-W53" }));
    expect(await savePlanExplanation(db, explanation({ periodKey: "2027-W01" }))).toEqual({
      saved: true,
    });
  });

  it("does not replace a stored 2027-W01 with 2026-W53", async () => {
    await savePlanExplanation(db, explanation({ periodKey: "2027-W01" }));
    expect(
      await savePlanExplanation(
        db,
        explanation({ periodKey: "2026-W53", factsFingerprint: "fp-b" }),
      ),
    ).toEqual({ saved: false });
    expect(await getPlanExplanation(db, 3, "beginner")).toMatchObject({ periodKey: "2027-W01" });
  });

  it("replaces on a higher version even with an older week", async () => {
    await savePlanExplanation(db, explanation());
    expect(
      await savePlanExplanation(
        db,
        explanation({
          promptVersion: 2,
          periodKey: "2026-W40",
          model: "new",
          content: content("新版"),
          factsFingerprint: "fp-a",
        }),
      ),
    ).toEqual({ saved: true });
    expect(await getPlanExplanation(db, 3, "beginner")).toMatchObject({
      promptVersion: 2,
      periodKey: "2026-W40",
      model: "new",
    });
  });

  it("never replaces with a lower version, even with a later week", async () => {
    await savePlanExplanation(db, explanation({ promptVersion: 3 }));
    expect(
      await savePlanExplanation(db, explanation({ promptVersion: 2, periodKey: "2026-W50" })),
    ).toEqual({ saved: false });
    expect(
      await savePlanExplanation(
        db,
        explanation({ promptVersion: 2, periodKey: "2026-W41", factsFingerprint: "fp-b" }),
      ),
    ).toEqual({ saved: false });
    expect(await getPlanExplanation(db, 3, "beginner")).toMatchObject({
      promptVersion: 3,
      periodKey: "2026-W41",
    });
  });

  it("rejects levels outside 1..5 and a bad period key in the database", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately out of range for the check constraint
    await expect(savePlanExplanation(db, explanation({ level: 0 as any }))).rejects.toThrow();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately out of range for the check constraint
    await expect(savePlanExplanation(db, explanation({ level: 6 as any }))).rejects.toThrow();
    await expect(
      savePlanExplanation(db, explanation({ periodKey: "2026-10-08" })),
    ).rejects.toThrow();
    await expect(savePlanExplanation(db, explanation({ periodKey: "2026W41" }))).rejects.toThrow();
    expect(await db.select().from(planExplanations)).toHaveLength(0);
    for (const level of [1, 5] as const)
      expect(await savePlanExplanation(db, explanation({ level }))).toEqual({ saved: true });
  });

  it("rejects content that does not match the schema before writing", async () => {
    await expect(
      savePlanExplanation(db, explanation({ content: { ...content(), headline: "" } })),
    ).rejects.toThrow();
    expect(await db.select().from(planExplanations)).toHaveLength(0);
  });

  it("throws PlanExplanationDriftError when stored content no longer matches the schema", async () => {
    await savePlanExplanation(db, explanation());
    await db.update(planExplanations).set({ content: { headline: "舊格式" } });
    const err = await getPlanExplanation(db, 3, "beginner").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanExplanationDriftError);
    expect((err as Error).name).toBe("PlanExplanationDriftError");
    expect((err as Error).message).toMatch(/3.*beginner/);
  });

  it("deleteStalePlanExplanation removes only a row with another fingerprint at a version not above", async () => {
    await savePlanExplanation(db, explanation({ promptVersion: 2 }));
    await savePlanExplanation(db, explanation({ lens: "pro", promptVersion: 2 }));
    await savePlanExplanation(db, explanation({ level: 4, promptVersion: 2 }));
    expect(await deleteStalePlanExplanation(db, 3, "beginner", "fp-a", 2)).toBe(0); // same structure
    expect(await deleteStalePlanExplanation(db, 3, "beginner", "fp-b", 1)).toBe(0); // stored version higher
    expect(await getPlanExplanation(db, 3, "beginner")).not.toBeNull();
    expect(await deleteStalePlanExplanation(db, 3, "beginner", "fp-b", 2)).toBe(1);
    expect(await getPlanExplanation(db, 3, "beginner")).toBeNull();
    expect(await getPlanExplanation(db, 3, "pro")).not.toBeNull();
    expect(await getPlanExplanation(db, 4, "beginner")).not.toBeNull();
    expect(await deleteStalePlanExplanation(db, 3, "pro", "fp-b", 3)).toBe(1); // stored version lower
    expect(await deleteStalePlanExplanation(db, 5, "pro", "fp-b", 3)).toBe(0); // nothing stored
  });

  it("hasPlanExplanation truth table", async () => {
    await savePlanExplanation(db, explanation({ promptVersion: 2, periodKey: "2026-W41" }));
    const has = (
      periodKey: string,
      promptVersion: number,
      level: 3 | 4 = 3,
      lens: "beginner" | "pro" = "beginner",
      fingerprint = "fp-a",
    ) => hasPlanExplanation(db, level, lens, periodKey, promptVersion, fingerprint);
    expect(await has("2026-W41", 2)).toBe(true); // same
    expect(await has("2026-W40", 2)).toBe(true); // stored week is later
    expect(await has("2026-W42", 2)).toBe(false); // wanted week is later
    expect(await has("2026-W42", 1)).toBe(true); // stored version higher
    expect(await has("2026-W41", 3)).toBe(false); // wanted version higher
    expect(await has("2026-W41", 2, 4)).toBe(false); // other level
    expect(await has("2026-W41", 2, 3, "pro")).toBe(false); // other lens
    expect(await has("2026-W41", 2, 3, "beginner", "fp-b")).toBe(false); // same week, new facts
    expect(await has("2026-W40", 2, 3, "beginner", "fp-b")).toBe(true); // stored week is later
    expect(await has("2026-W41", 1, 3, "beginner", "fp-b")).toBe(true); // stored version higher
  });
});
