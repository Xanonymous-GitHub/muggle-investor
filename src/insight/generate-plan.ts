import {
  deleteStalePlanExplanation,
  hasPlanExplanation,
  savePlanExplanation,
} from "@/db/repositories/plan-explanations";
import type { PlanReference } from "@/planner/plan-service";
import { buildPlanFacts, planFingerprint } from "./facts-plan";
import type { Lens } from "./lens";
import { type ProduceDeps, type ProduceResult, produceValidated } from "./pipeline";
import { buildPlanPrompts, PLAN_EXTRA_ADVICE_WORDS, PLAN_PROMPT_VERSION } from "./prompts/plan";

const PLAN_NOUN = { zh: "說明", en: "plan explanation" };

/**
 * Produces and stores the explanation of one level's reference run in one lens. Skips (no LLM
 * call) when the stored explanation already covers this run's week, prompt version and structure
 * (`planFingerprint`): a fund switch or a slice held as cash mid-week regenerates it, new metric
 * figures alone do not. Validation is as strict as the daily briefing's (weekday-session wording
 * counts as a prediction) plus `PLAN_EXTRA_ADVICE_WORDS`. Before the LLM call, a stored text for
 * another structure at a version not above ours is deleted (R-E10), so a rejected output leaves
 * no text rather than a stale one; with the same structure the previous text keeps serving.
 * Usage is recorded under `plan:<lens>`; a rejected output stores nothing, and an `LlmOutputError` propagates without storing. Throws
 * (before any LLM call) when the reference's weights do not sum to 100.
 */
export async function generatePlanExplanation(
  deps: ProduceDeps,
  input: { reference: PlanReference; lens: Lens },
): Promise<ProduceResult> {
  const { db, llm, logger, now } = deps;
  const { reference, lens } = input;
  const { level } = reference;
  const facts = buildPlanFacts(reference);
  const factsFingerprint = planFingerprint(reference);
  if (
    await hasPlanExplanation(
      db,
      level,
      lens,
      facts.periodKey,
      PLAN_PROMPT_VERSION,
      factsFingerprint,
    )
  ) {
    return { status: "skipped" };
  }
  // Text written for another structure (or a sample) must not outlive it, even if the new text
  // is rejected: the endpoint answers 404 until a new text passes the checks.
  const removed = await deleteStalePlanExplanation(
    db,
    level,
    lens,
    factsFingerprint,
    PLAN_PROMPT_VERSION,
  );
  if (removed > 0) {
    logger.warn(
      { level, lens, periodKey: facts.periodKey },
      "plan explanation structure changed; stale text removed",
    );
  }

  const { system, prompt } = buildPlanPrompts(lens, level, facts);
  const result = await produceValidated(deps, {
    purpose: `plan:${lens}`,
    context: { level, lens, periodKey: facts.periodKey },
    system,
    prompt,
    facts,
    weekdaySessions: true,
    noun: PLAN_NOUN,
    extraAdviceWords: PLAN_EXTRA_ADVICE_WORDS,
  });
  if (result.status === "rejected") return { status: "rejected", reasons: result.reasons };

  const { saved } = await savePlanExplanation(db, {
    level,
    lens,
    periodKey: facts.periodKey,
    promptVersion: PLAN_PROMPT_VERSION,
    model: llm.modelId,
    content: { ...result.content, termIds: result.termIds },
    factsFingerprint,
    ...(now && { createdAt: now() }),
  });
  // Not saved when an explanation covering this week and structure was stored meanwhile.
  return { status: saved ? "saved" : "skipped" };
}
