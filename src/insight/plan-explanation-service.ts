import type { Db } from "@/db/client";
import {
  getPlanExplanation,
  type PlanExplanation,
  PlanExplanationDriftError,
} from "@/db/repositories/plan-explanations";
import { type GlossaryTerm, getTerm } from "@/glossary";
import { logger } from "@/lib/logger";
import type { RiskLevel } from "@/planner/rules/questionnaire";
import type { Lens } from "./lens";

/** A stored explanation as readers see it: the facts fingerprint is internal and left out. */
export type PublicPlanExplanation = Omit<PlanExplanation, "factsFingerprint">;

export type PlanExplanationResponse = {
  explanation: PublicPlanExplanation;
  terms: Record<string, GlossaryTerm>;
};

/**
 * The stored explanation for the level and lens, without its facts fingerprint, with the glossary
 * entries it cites; ids the glossary lacks are dropped. A stored row that no longer matches the content schema reads as
 * missing, not as a failure.
 */
export async function getPlanExplanationWithTerms(
  db: Db,
  level: RiskLevel,
  lens: Lens,
): Promise<PlanExplanationResponse | null> {
  try {
    const stored = await getPlanExplanation(db, level, lens);
    if (!stored) return null;
    const { factsFingerprint: _internal, ...explanation } = stored;
    const terms: Record<string, GlossaryTerm> = {};
    for (const id of explanation.content.termIds) {
      const term = getTerm(id);
      if (term) terms[id] = term;
    }
    return { explanation, terms };
  } catch (error) {
    if (!(error instanceof PlanExplanationDriftError)) throw error;
    logger.warn(
      { level, lens, reason: error.message },
      "stored plan explanation is drifted; treating as not found",
    );
    return null;
  }
}
