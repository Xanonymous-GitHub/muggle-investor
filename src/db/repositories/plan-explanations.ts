import { and, eq, sql } from "drizzle-orm";
import { type BriefingContent, briefingContentSchema } from "@/insight/briefing-content";
import type { Lens } from "@/insight/lens";
import type { RiskLevel } from "@/planner/rules/questionnaire";
import type { Db } from "../client";
import { planExplanations } from "../schema";

export type PlanExplanation = {
  level: RiskLevel;
  lens: Lens;
  /** ISO week (`YYYY-Www`) the explanation was generated for. */
  periodKey: string;
  promptVersion: number;
  model: string;
  content: BriefingContent;
  /** Hash of the structural facts the text was written from (`planFingerprint`). */
  factsFingerprint: string;
  createdAt: Date;
};

type PlanExplanationRow = typeof planExplanations.$inferSelect;

/** A stored explanation no longer matches the content schema (as opposed to a database failure). */
export class PlanExplanationDriftError extends Error {
  override name = "PlanExplanationDriftError";
}

/** Validates stored JSON on the way out so schema drift fails loudly instead of reaching readers. */
function toPlanExplanation(row: PlanExplanationRow): PlanExplanation {
  const content = briefingContentSchema.safeParse(row.content);
  if (!content.success) {
    throw new PlanExplanationDriftError(
      `Stored plan explanation level ${row.level} (${row.lens}) no longer matches the content schema: ${content.error.message}`,
    );
  }
  return {
    level: row.level as RiskLevel,
    lens: row.lens,
    periodKey: row.periodKey,
    promptVersion: row.promptVersion,
    model: row.model,
    content: content.data,
    factsFingerprint: row.factsFingerprint,
    createdAt: row.createdAt,
  };
}

/**
 * Stores the explanation for `(level, lens)`. An existing row is replaced, in one atomic statement,
 * only when `promptVersion` is greater, or equal with a later `periodKey` (ISO weeks sort as
 * strings), or equal with the same `periodKey` and a different `factsFingerprint` (the run's
 * structure changed within the week); otherwise nothing changes and `{ saved: false }` is returned. `level` must be 1..5 and
 * `periodKey` `YYYY-Www` (database check constraints), and `content` must satisfy
 * `briefingContentSchema` (throws before writing).
 */
export async function savePlanExplanation(
  db: Db,
  e: Omit<PlanExplanation, "createdAt"> & { createdAt?: Date },
): Promise<{ saved: boolean }> {
  const content = briefingContentSchema.parse(e.content);
  const rows = await db
    .insert(planExplanations)
    .values({ ...e, content })
    .onConflictDoUpdate({
      target: [planExplanations.level, planExplanations.lens],
      set: {
        periodKey: sql`excluded.period_key`,
        promptVersion: sql`excluded.prompt_version`,
        model: sql`excluded.model`,
        content: sql`excluded.content`,
        factsFingerprint: sql`excluded.facts_fingerprint`,
        createdAt: sql`excluded.created_at`,
      },
      setWhere: sql`excluded.prompt_version > ${planExplanations.promptVersion} or (excluded.prompt_version = ${planExplanations.promptVersion} and (excluded.period_key > ${planExplanations.periodKey} or (excluded.period_key = ${planExplanations.periodKey} and excluded.facts_fingerprint <> ${planExplanations.factsFingerprint})))`,
    })
    .returning({ level: planExplanations.level });
  return { saved: rows.length > 0 };
}

export async function getPlanExplanation(
  db: Db,
  level: RiskLevel,
  lens: Lens,
): Promise<PlanExplanation | null> {
  const [row] = await db
    .select()
    .from(planExplanations)
    .where(and(eq(planExplanations.level, level), eq(planExplanations.lens, lens)))
    .limit(1);
  return row ? toPlanExplanation(row) : null;
}

/**
 * True when the stored row already covers `(periodKey, promptVersion, fingerprint)`: its version
 * is higher, or equal with a later period, or equal with the same period and the same
 * fingerprint. Mirrors the replace rule of `savePlanExplanation`.
 */
export async function hasPlanExplanation(
  db: Db,
  level: RiskLevel,
  lens: Lens,
  periodKey: string,
  promptVersion: number,
  fingerprint: string,
): Promise<boolean> {
  const rows = await db
    .select({ level: planExplanations.level })
    .from(planExplanations)
    .where(
      and(
        eq(planExplanations.level, level),
        eq(planExplanations.lens, lens),
        sql`(${planExplanations.promptVersion} > ${promptVersion} or (${planExplanations.promptVersion} = ${promptVersion} and (${planExplanations.periodKey} > ${periodKey} or (${planExplanations.periodKey} = ${periodKey} and ${planExplanations.factsFingerprint} = ${fingerprint}))))`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
