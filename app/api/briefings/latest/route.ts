import { getLatestBriefing } from "@/insight/briefing-service";
import { lensParamSchema } from "@/insight/lens";
import { logger } from "@/lib/logger";
import { cachedJson, errorJson } from "@/market/responses";
import { safeErrorMessage } from "@/server/safe-error";
import { getDb } from "@/server/services";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

/** The newest daily briefing for the lens, with the glossary entries it cites. Public until invite-code auth lands. */
export async function GET(request: Request): Promise<Response> {
  const lens = lensParamSchema.safeParse(
    new URL(request.url).searchParams.get("lens") ?? undefined,
  );
  if (!lens.success) return errorJson("invalid lens", 400);
  try {
    const result = await getLatestBriefing(getDb(), lens.data);
    if (!result) return errorJson("not_found", 404);
    return cachedJson(result, CACHE, result.briefing.periodKey);
  } catch (error) {
    logger.error({ error: safeErrorMessage(error) }, "latest briefing failed");
    return errorJson("internal_error", 500);
  }
}
