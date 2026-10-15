import { eq } from "drizzle-orm";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { getPlanExplanation } from "@/db/repositories/plan-explanations";
import { priceBars } from "@/db/schema";
import type { BriefingContent } from "@/insight/briefing-content";
import { LENSES, type Lens } from "@/insight/lens";
import type { GenerateObjectRequest, Llm } from "@/insight/llm";
import { PLAN_BEGINNER_SECTION_TITLE } from "@/insight/prompts/plan";
import { EDUCATION_DISCLAIMER } from "@/insight/prompts/shared";
import * as planService from "@/planner/plan-service";
import { PLAN_NOW, seedPlanMarket } from "../../test/helpers/plan-fixtures";
import { createTestDb } from "../../test/helpers/test-db";
import { BRIEFING_RUN_BUDGET_MS, createLlmBreaker } from "./briefings";
import { generatePlanExplanations } from "./plan-explanations";
import type { IngestionAction, Recorder } from "./run-ingestion";

vi.mock("@/planner/plan-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/planner/plan-service")>();
  return { ...actual, planReference: vi.fn(actual.planReference) };
});
const actualPlanService =
  await vi.importActual<typeof import("@/planner/plan-service")>("@/planner/plan-service");

const silent = pino({ level: "silent" });
const NEXT_WEEK = new Date(PLAN_NOW.getTime() + 7 * 86_400_000);

/** No numbers, so it is grounded for every level's fact sheet. */
const PLAIN: BriefingContent = {
  headline: "這個配置分成幾個部位",
  summary: "核心、債券、高股息、衛星和現金各有各的角色。",
  sections: [
    { title: "這段期間的表現", body: "在這段資料期間，這個組合曾經有漲有跌。" },
    { title: PLAN_BEGINNER_SECTION_TITLE, body: "最大回撤像爬山時從山頂往下走的最深一段。" },
  ],
  takeaway: EDUCATION_DISCLAIMER,
  termIds: [],
};
const INVENTED: BriefingContent = { ...PLAIN, summary: "年化報酬率是 31.4%。" };

const lensOf = (req: GenerateObjectRequest<unknown>): Lens =>
  req.system.includes("【讀者：專業投資人】") ? "pro" : "beginner";

type Behavior = (call: number, req: GenerateObjectRequest<unknown>) => BriefingContent;

function fakeLlm(behavior: Behavior = () => PLAIN) {
  const requests: GenerateObjectRequest<unknown>[] = [];
  const llm: Llm = {
    modelId: "fake-model",
    async generateObject<T>(req: GenerateObjectRequest<T>) {
      requests.push(req);
      return {
        object: req.schema.parse(behavior(requests.length, req)),
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
  return { llm, requests };
}

/** The same record/attempt semantics as `runIngestion`'s recorder. */
function collect() {
  const actions: IngestionAction[] = [];
  const failure = (error: unknown) => ({
    status: "failed" as const,
    detail: error instanceof Error ? error.message : String(error),
  });
  const recorder: Recorder = {
    async record(name, step) {
      try {
        actions.push({ name, ...(await step()) });
      } catch (error) {
        actions.push({ name, ...failure(error) });
      }
    },
    async attempt(names, compute) {
      try {
        return { ok: true, value: await compute() };
      } catch (error) {
        for (const name of names) actions.push({ name, ...failure(error) });
        return { ok: false };
      }
    },
  };
  return { actions, recorder };
}

const NAMES = [1, 2, 3, 4, 5].flatMap((level) =>
  LENSES.map((lens) => `plan_explanation:${level}:${lens}`),
);

describe("generatePlanExplanations", () => {
  let db: Db;
  let llm: ReturnType<typeof fakeLlm>;

  const run = async (
    options: {
      now?: Date;
      clock?: () => number;
      budgetMs?: number;
      breaker?: ReturnType<typeof createLlmBreaker>;
    } = {},
  ) => {
    const { actions, recorder } = collect();
    const clock = options.clock ?? (() => 0);
    await generatePlanExplanations(
      {
        db,
        logger: silent,
        now: options.now ?? PLAN_NOW,
        clock,
        ...(options.budgetMs !== undefined && { briefingRunBudgetMs: options.budgetMs }),
      },
      recorder,
      { startedAt: clock(), breaker: options.breaker ?? createLlmBreaker(llm.llm) },
    );
    return actions;
  };
  const byName = (actions: IngestionAction[], name: string) =>
    actions.find((action) => action.name === name);

  beforeEach(async () => {
    vi.mocked(planService.planReference).mockImplementation(actualPlanService.planReference);
    db = await createTestDb();
    await seedPlanMarket(db);
    llm = fakeLlm();
  });

  it("stores all 10 explanations level by level, then skips them in the same week", async () => {
    const actions = await run();

    expect(actions.map((a) => a.name)).toEqual(NAMES);
    for (const action of actions) expect(action).toEqual({ name: action.name, status: "done" });
    expect(llm.requests).toHaveLength(10);
    for (const level of [1, 2, 3, 4, 5] as const) {
      for (const lens of LENSES) {
        expect(await getPlanExplanation(db, level, lens)).toMatchObject({ periodKey: "2026-W42" });
      }
    }
    // One reference per level, shared by both lenses.
    expect(planService.planReference).toHaveBeenCalledTimes(5);

    llm.requests.length = 0;
    const again = await run();

    for (const name of NAMES) {
      expect(byName(again, name)).toEqual({ name, status: "skipped", detail: "already stored" });
    }
    expect(llm.requests).toHaveLength(0);
  });

  it("regenerates all 10 in the next ISO week", async () => {
    await run();
    llm.requests.length = 0;

    const actions = await run({ now: NEXT_WEEK });

    for (const action of actions) expect(action.status).toBe("done");
    expect(llm.requests).toHaveLength(10);
    expect(await getPlanExplanation(db, 3, "pro")).toMatchObject({ periodKey: "2026-W43" });
  });

  it("regenerates only the levels whose structure changed mid-week", async () => {
    await run();
    llm.requests.length = 0;
    // The bond fund drops out: levels 1-4 hold their bond slice as cash; level 5 has none.
    await db.delete(priceBars).where(eq(priceBars.symbol, "00679B"));

    const actions = await run();

    for (const level of [1, 2, 3, 4]) {
      for (const lens of LENSES) {
        expect(byName(actions, `plan_explanation:${level}:${lens}`)?.status).toBe("done");
      }
    }
    for (const lens of LENSES) {
      expect(byName(actions, `plan_explanation:5:${lens}`)).toMatchObject({
        status: "skipped",
        detail: "already stored",
      });
    }
    expect(llm.requests).toHaveLength(8);
  });

  it("skips every remaining action once the run time budget is spent", async () => {
    let elapsed = 0;
    const clock = () => elapsed;
    // The third call (level 2, beginner) uses up the whole budget.
    llm = fakeLlm((call) => {
      if (call === 3) elapsed += BRIEFING_RUN_BUDGET_MS;
      return PLAIN;
    });

    const actions = await run({ clock });

    expect(actions.map((a) => a.name)).toEqual(NAMES);
    expect(actions.slice(0, 3).map((a) => a.status)).toEqual(["done", "done", "done"]);
    for (const action of actions.slice(3)) {
      expect(action).toMatchObject({ status: "skipped", detail: "run time budget exhausted" });
    }
    expect(llm.requests).toHaveLength(3);
    // Levels 3-5 never start, so their references are not computed.
    expect(planService.planReference).toHaveBeenCalledTimes(2);
  });

  it("honours an injected budget measured from the run's start", async () => {
    let elapsed = 0;
    const actions = await run({ clock: () => elapsed, budgetMs: 10 });
    expect(actions.every((a) => a.status === "done")).toBe(true);

    elapsed = 10;
    const { actions: late, recorder } = collect();
    await generatePlanExplanations(
      { db, logger: silent, now: NEXT_WEEK, clock: () => elapsed, briefingRunBudgetMs: 10 },
      recorder,
      { startedAt: 0, breaker: createLlmBreaker(llm.llm) },
    );
    expect(late.map((a) => a.name)).toEqual(NAMES);
    for (const action of late) expect(action.detail).toBe("run time budget exhausted");
    expect(planService.planReference).toHaveBeenCalledTimes(5);
  });

  it("after the first thrown LLM error, skips the rest without calling the LLM", async () => {
    llm = fakeLlm(() => {
      throw new Error("LLM timed out");
    });

    const actions = await run();

    expect(llm.requests).toHaveLength(1);
    expect(actions[0]).toEqual({ name: NAMES[0], status: "failed", detail: "LLM timed out" });
    for (const action of actions.slice(1)) {
      expect(action).toMatchObject({
        status: "skipped",
        detail: "LLM unavailable earlier in this run",
      });
    }
    // No reference is computed for levels the breaker already skips.
    expect(planService.planReference).toHaveBeenCalledTimes(1);
  });

  it("skips everything without an LLM call when the breaker tripped earlier in the run", async () => {
    const breaker = createLlmBreaker(llm.llm);
    vi.spyOn(breaker, "isDown").mockReturnValue(true);

    const actions = await run({ breaker });

    expect(actions.map((a) => a.name)).toEqual(NAMES);
    for (const action of actions) {
      expect(action.detail).toBe("LLM unavailable earlier in this run");
    }
    expect(llm.requests).toHaveLength(0);
  });

  it("skips every level without an LLM call when no core fund has bars", async () => {
    await db.delete(priceBars).where(eq(priceBars.symbol, "0050"));

    const actions = await run();

    expect(actions.map((a) => a.name)).toEqual(NAMES);
    for (const action of actions) {
      expect(action).toMatchObject({ status: "skipped", detail: "no eligible core instrument" });
    }
    expect(llm.requests).toHaveLength(0);
  });

  it("skips a level whose reference has too little history", async () => {
    vi.mocked(planService.planReference).mockImplementation(async (deps, level) =>
      level === 2 ? null : actualPlanService.planReference(deps, level),
    );

    const actions = await run();

    for (const lens of LENSES) {
      expect(byName(actions, `plan_explanation:2:${lens}`)).toMatchObject({
        status: "skipped",
        detail: "not enough price history",
      });
    }
    expect(llm.requests).toHaveLength(8);
  });

  it("an unexpected reference error fails only that level", async () => {
    vi.mocked(planService.planReference).mockImplementation(async (deps, level) => {
      if (level === 4) throw new Error("db read failed");
      return actualPlanService.planReference(deps, level);
    });

    const actions = await run();

    for (const lens of LENSES) {
      expect(byName(actions, `plan_explanation:4:${lens}`)).toEqual({
        name: `plan_explanation:4:${lens}`,
        status: "failed",
        detail: "db read failed",
      });
    }
    expect(actions.filter((a) => a.status === "done")).toHaveLength(8);
    expect(byName(actions, "plan_explanation:5:pro")?.status).toBe("done");
  });

  it("a rejected output for one level and lens does not block the others", async () => {
    let level3Pro = 0;
    llm = fakeLlm((_call, req) => {
      const isLevel3Pro = req.system.includes("風險等級 3 的預設配置") && lensOf(req) === "pro";
      if (isLevel3Pro) level3Pro++;
      return isLevel3Pro ? INVENTED : PLAIN;
    });

    const actions = await run();

    expect(level3Pro).toBe(2); // the first answer and its repair
    expect(byName(actions, "plan_explanation:3:pro")).toMatchObject({
      status: "skipped",
      detail: expect.stringMatching(/^rejected: .*31\.4/),
    });
    expect(actions.filter((a) => a.status === "done")).toHaveLength(9);
    expect(await getPlanExplanation(db, 3, "pro")).toBeNull();
  });
});
