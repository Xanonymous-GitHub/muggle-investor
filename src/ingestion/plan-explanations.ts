import { generatePlanExplanation } from "@/insight/generate-plan";
import { LENSES } from "@/insight/lens";
import type { ProduceDeps } from "@/insight/pipeline";
import { DataUnavailableError, type PlanReference, planReference } from "@/planner/plan-service";
import type { RiskLevel } from "@/planner/rules/questionnaire";
import {
  BRIEFING_RUN_BUDGET_MS,
  BUDGET_EXHAUSTED,
  LLM_UNAVAILABLE,
  type LlmBreaker,
  outcomeOf,
} from "./briefings";
import type { IngestionDeps, Outcome, Recorder } from "./run-ingestion";

const LEVELS: readonly RiskLevel[] = [1, 2, 3, 4, 5];

const NOT_ENOUGH_HISTORY: Outcome = { status: "skipped", detail: "not enough price history" };
const NO_CORE: Outcome = { status: "skipped", detail: "no eligible core instrument" };

/**
 * The weekly plan explanations: for each level 1-5 (level-major, so a budget cutoff leaves whole
 * levels done) and each lens, one action `plan_explanation:<level>:<lens>`. A level's reference
 * run is computed once and shared by both lenses, and only when one of them still starts;
 * `generatePlanExplanation` then skips (no LLM call) what is already stored for this week,
 * prompt version and structure. Shares the briefings' start-gate budget (`BRIEFING_RUN_BUDGET_MS`
 * from the run's `startedAt`) and the run's LLM `breaker`: once the LLM has thrown in this run,
 * remaining actions are skipped without computing references or calling it. A failure in one
 * level fails only that level's actions.
 */
export async function generatePlanExplanations(
  deps: Pick<IngestionDeps, "db" | "logger" | "now" | "clock" | "briefingRunBudgetMs">,
  { record, attempt }: Recorder,
  { startedAt, breaker }: { startedAt: number; breaker: LlmBreaker },
): Promise<void> {
  const { db, logger, now } = deps;
  const clock = deps.clock ?? Date.now;
  const budget = deps.briefingRunBudgetMs ?? BRIEFING_RUN_BUDGET_MS;
  let outOfTime = false;
  const budgetSpent = (): boolean => {
    outOfTime ||= clock() - startedAt >= budget;
    return outOfTime;
  };
  const produceDeps: ProduceDeps = { db, llm: breaker.llm, logger, now: () => now };

  for (const level of LEVELS) {
    const names = LENSES.map((lens) => `plan_explanation:${level}:${lens}`);
    const blocked = budgetSpent() ? BUDGET_EXHAUSTED : breaker.isDown() ? LLM_UNAVAILABLE : null;
    if (blocked) {
      for (const name of names) await record(name, async () => blocked);
      continue;
    }

    const computed = await attempt(names, async (): Promise<PlanReference | Outcome> => {
      try {
        return (await planReference({ db, now }, level)) ?? NOT_ENOUGH_HISTORY;
      } catch (error) {
        if (error instanceof DataUnavailableError) return NO_CORE;
        throw error;
      }
    });
    if (!computed.ok) continue;
    const reference = computed.value;

    for (const [i, lens] of LENSES.entries()) {
      await record(names[i] as string, async () => {
        if ("status" in reference) return reference;
        if (budgetSpent()) return BUDGET_EXHAUSTED;
        if (breaker.isDown()) return LLM_UNAVAILABLE;
        return outcomeOf(await generatePlanExplanation(produceDeps, { reference, lens }));
      });
    }
  }
}
