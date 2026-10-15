import { hasPlanExplanation, savePlanExplanation } from "@/db/repositories/plan-explanations";
import type { PlanReference } from "@/planner/plan-service";
import { buildPlanFacts } from "./facts-plan";
import type { Lens } from "./lens";
import { type ProduceDeps, type ProduceResult, produceValidated } from "./pipeline";
import { buildPlanPrompts, PLAN_PROMPT_VERSION } from "./prompts/plan";

const PLAN_NOUN = { zh: "說明", en: "plan explanation" };

/**
 * Produces and stores the explanation of one level's reference run in one lens. Skips (no LLM
 * call) when the stored explanation already covers this run's week and the prompt version.
 * Usage is recorded under `plan:<lens>`; a rejected output stores nothing, and an
 * `LlmOutputError` propagates without storing. Throws (before any LLM call) when the reference's
 * weights do not sum to 100.
 */
export async function generatePlanExplanation(
  deps: ProduceDeps,
  input: { reference: PlanReference; lens: Lens },
): Promise<ProduceResult> {
  const { db, llm, now } = deps;
  const { reference, lens } = input;
  const { level } = reference;
  const facts = buildPlanFacts(reference);
  if (await hasPlanExplanation(db, level, lens, facts.periodKey, PLAN_PROMPT_VERSION)) {
    return { status: "skipped" };
  }

  const { system, prompt } = buildPlanPrompts(lens, level, facts);
  const result = await produceValidated(deps, {
    purpose: `plan:${lens}`,
    context: { level, lens, periodKey: facts.periodKey },
    system,
    prompt,
    facts,
    weekdaySessions: false,
    noun: PLAN_NOUN,
  });
  if (result.status === "rejected") return { status: "rejected", reasons: result.reasons };

  const { saved } = await savePlanExplanation(db, {
    level,
    lens,
    periodKey: facts.periodKey,
    promptVersion: PLAN_PROMPT_VERSION,
    model: llm.modelId,
    content: { ...result.content, termIds: result.termIds },
    ...(now && { createdAt: now() }),
  });
  // Not saved when an explanation for an equal or later week was stored meanwhile.
  return { status: saved ? "saved" : "skipped" };
}
