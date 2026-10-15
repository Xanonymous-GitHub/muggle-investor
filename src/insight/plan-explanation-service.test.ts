import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { savePlanExplanation } from "@/db/repositories/plan-explanations";
import { planExplanations } from "@/db/schema";
import type { BriefingContent } from "@/insight/briefing-content";
import { createTestDb } from "../../test/helpers/test-db";
import { getPlanExplanationWithTerms } from "./plan-explanation-service";

const warn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { warn: (...args: unknown[]) => warn(...args) } }));

const content = (termIds: string[]): BriefingContent => ({
  headline: "保守型的配置重點",
  summary: "這個等級以債券為主。",
  sections: [
    { title: "組成", body: "債券比重較高。" },
    { title: "風險", body: "股票比重較低。" },
  ],
  takeaway: "以上為資料整理與教育說明，不構成投資建議。",
  termIds,
});

const save = (termIds: string[], lens: "beginner" | "pro" = "beginner") =>
  savePlanExplanation(db, {
    level: 2,
    lens,
    periodKey: "2026-W41",
    promptVersion: 1,
    model: "test-model",
    factsFingerprint: "fp",
    content: content(termIds),
  });

let db: Db;

describe("getPlanExplanationWithTerms", () => {
  beforeEach(async () => {
    warn.mockReset();
    db = await createTestDb();
  });

  it("returns the explanation with terms for exactly its termIds", async () => {
    await save(["force", "sector"]);
    const result = await getPlanExplanationWithTerms(db, 2, "beginner");
    expect(result?.explanation).toMatchObject({
      level: 2,
      lens: "beginner",
      periodKey: "2026-W41",
    });
    expect(Object.keys(result?.terms ?? {}).sort()).toEqual(["force", "sector"]);
    expect(result?.terms.force?.id).toBe("force");
  });

  it("leaves the internal facts fingerprint out of the explanation", async () => {
    await save(["force"]);
    const result = await getPlanExplanationWithTerms(db, 2, "beginner");
    expect(result?.explanation).toBeDefined();
    expect(result?.explanation).not.toHaveProperty("factsFingerprint");
  });

  it("silently drops termIds that are not in the glossary", async () => {
    await save(["force", "no-such-term"]);
    const result = await getPlanExplanationWithTerms(db, 2, "beginner");
    expect(Object.keys(result?.terms ?? {})).toEqual(["force"]);
  });

  it("returns null for another level or lens", async () => {
    await save(["force"]);
    expect(await getPlanExplanationWithTerms(db, 3, "beginner")).toBeNull();
    expect(await getPlanExplanationWithTerms(db, 2, "pro")).toBeNull();
  });

  it("treats a drifted row as not found, with one warn", async () => {
    await save(["force"]);
    await db.update(planExplanations).set({ content: { headline: "舊格式" } });
    expect(await getPlanExplanationWithTerms(db, 2, "beginner")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still throws on a database failure", async () => {
    await expect(getPlanExplanationWithTerms({} as Db, 2, "beginner")).rejects.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
