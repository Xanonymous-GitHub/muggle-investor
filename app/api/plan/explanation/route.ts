import { lensParamSchema } from "@/insight/lens";
import { getPlanExplanationWithTerms } from "@/insight/plan-explanation-service";
import { logger } from "@/lib/logger";
import { cachedJson, errorJson } from "@/market/responses";
import type { RiskLevel } from "@/planner/rules/questionnaire";
import { safeErrorMessage } from "@/server/safe-error";
import { getDb } from "@/server/services";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

/** Plain digits 1-5 only: `1.5`, `01`, ` 2` and the like are rejected rather than coerced. */
const parseLevel = (raw: string | null): RiskLevel | null =>
  raw !== null && /^[1-5]$/.test(raw) ? (Number(raw) as RiskLevel) : null;

/** The weekly explanation of a risk level's allocation, with the glossary entries it cites. Public until invite-code auth lands. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const level = parseLevel(params.get("level"));
  if (level === null) return errorJson("invalid level", 400);
  const lens = lensParamSchema.safeParse(params.get("lens") ?? undefined);
  if (!lens.success) return errorJson("invalid lens", 400);
  try {
    const result = await getPlanExplanationWithTerms(getDb(), level, lens.data);
    if (!result) return errorJson("not_found", 404);
    // The facts fingerprint is internal: it stays out of the response.
    const { factsFingerprint: _internal, ...explanation } = result.explanation;
    return cachedJson({ explanation, terms: result.terms }, CACHE);
  } catch (error) {
    logger.error({ error: safeErrorMessage(error) }, "plan explanation failed");
    return errorJson("internal_error", 500);
  }
}
