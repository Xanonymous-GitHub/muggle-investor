import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { getPlanExplanation, savePlanExplanation } from "@/db/repositories/plan-explanations";
import { llmUsage } from "@/db/schema";
import { LEVEL3_REFERENCE } from "../../test/helpers/plan-fixtures";
import { createTestDb } from "../../test/helpers/test-db";
import type { BriefingContent } from "./briefing-content";
import { buildPlanFacts } from "./facts-plan";
import { generatePlanExplanation } from "./generate-plan";
import { checkGrounding, findAdviceWording, findForbiddenPredictions } from "./grounding";
import { LENSES } from "./lens";
import type { GenerateObjectRequest, Llm } from "./llm";
import { buildPlanPrompts, PLAN_BEGINNER_SECTION_TITLE, PLAN_PROMPT_VERSION } from "./prompts/plan";
import { EDUCATION_DISCLAIMER } from "./prompts/shared";

const reference = LEVEL3_REFERENCE;
const facts = buildPlanFacts(reference);
const NOW = new Date("2026-10-15T06:00:00Z");

const valid: BriefingContent = {
  headline: "風險等級 3 的配置與它的歷史試算",
  summary: "核心 45%、債券 25%、高股息 20%、衛星 5%、現金 5%。",
  sections: [
    {
      title: "這段期間的表現",
      body: "在 2017-01-17 至 2026-10-14 這 9.7 年，這個組合的年化報酬率是 +7.35%，最大回撤 -23.46%。",
    },
    { title: PLAN_BEGINNER_SECTION_TITLE, body: "最大回撤像爬山時，從山頂往下走的最深一段。" },
  ],
  takeaway: EDUCATION_DISCLAIMER,
  termIds: ["cagr", "max-drawdown"],
};

const withBody = (body: string): BriefingContent => ({
  ...valid,
  sections: [{ title: "這段期間的表現", body }, ...valid.sections.slice(1)],
});

/** A fake LLM that answers each call from `steps` in order and remembers every request. */
function fakeLlm(steps: BriefingContent[]) {
  const requests: GenerateObjectRequest<unknown>[] = [];
  const llm: Llm = {
    modelId: "fake-model",
    async generateObject<T>(req: GenerateObjectRequest<T>) {
      requests.push(req);
      const step = steps[requests.length - 1];
      if (step === undefined) throw new Error("unexpected extra LLM call");
      return { object: req.schema.parse(step), usage: { inputTokens: 800, outputTokens: 200 } };
    },
  };
  return { llm, requests };
}

describe("generatePlanExplanation", () => {
  let db: Db;
  const logger = pino({ level: "silent" });
  const deps = (llm: Llm) => ({ db, llm, logger, now: () => NOW });
  const usageRows = () => db.select().from(llmUsage);

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("uses fake content that every validator accepts", () => {
    const text = [valid.headline, valid.summary, ...valid.sections.map((s) => s.body)].join("\n");
    expect(checkGrounding(text, facts)).toEqual({ ok: true, ungrounded: [] });
    expect(findForbiddenPredictions(text)).toEqual([]);
    expect(findAdviceWording(text)).toEqual([]);
  });

  it.each(LENSES)("stores the %s explanation once and skips the same week", async (lens) => {
    const { llm, requests } = fakeLlm([valid]);

    expect(await generatePlanExplanation(deps(llm), { reference, lens })).toEqual({
      status: "saved",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.prompt).toBe(facts.text);
    expect(requests[0]?.system).toBe(buildPlanPrompts(lens, 3, facts).system);
    const stored = await getPlanExplanation(db, 3, lens);
    expect(stored).toMatchObject({
      level: 3,
      lens,
      periodKey: "2026-W42",
      promptVersion: PLAN_PROMPT_VERSION,
      model: "fake-model",
      createdAt: NOW,
    });
    expect(stored?.content.headline).toBe(valid.headline);
    expect(stored?.content.termIds.slice(0, 2)).toEqual(valid.termIds);
    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ purpose: `plan:${lens}`, inputTokens: 800 });

    expect(await generatePlanExplanation(deps(llm), { reference, lens })).toEqual({
      status: "skipped",
    });
    expect(requests).toHaveLength(1);
    expect(await usageRows()).toHaveLength(1);
  });

  it("repairs once, then rejects an invented number and stores nothing", async () => {
    const invented = withBody("這段期間的年化報酬率是 31.4%。");
    const { llm, requests } = fakeLlm([invented, invented]);

    const result = await generatePlanExplanation(deps(llm), { reference, lens: "pro" });

    expect(result.status).toBe("rejected");
    expect(result.reasons?.join("\n")).toContain("31.4");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.prompt).toContain("你上一版的說明沒有通過檢查");
    expect(await getPlanExplanation(db, 3, "pro")).toBeNull();
    const usage = await usageRows();
    expect(usage).toHaveLength(2);
    expect(usage.every((row) => row.purpose === "plan:pro")).toBe(true);
  });

  it("rejects a prediction", async () => {
    const predicting = withBody("核心 45%，明天可能上漲。");
    const { llm } = fakeLlm([predicting, predicting]);

    const result = await generatePlanExplanation(deps(llm), { reference, lens: "beginner" });

    expect(result.status).toBe("rejected");
    expect(result.reasons?.join("\n")).toContain("明天可能上漲");
    expect(await getPlanExplanation(db, 3, "beginner")).toBeNull();
  });

  it("replaces an explanation stored for an earlier week", async () => {
    await savePlanExplanation(db, {
      level: 3,
      lens: "beginner",
      periodKey: "2026-W41",
      promptVersion: PLAN_PROMPT_VERSION,
      model: "old-model",
      content: { ...valid, headline: "上週的說明" },
    });
    const { llm, requests } = fakeLlm([valid]);

    const result = await generatePlanExplanation(deps(llm), { reference, lens: "beginner" });

    expect(result).toEqual({ status: "saved" });
    expect(requests).toHaveLength(1);
    expect(await getPlanExplanation(db, 3, "beginner")).toMatchObject({
      periodKey: "2026-W42",
      model: "fake-model",
      content: { headline: valid.headline },
    });
  });
});
