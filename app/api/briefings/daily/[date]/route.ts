import { getDailyBriefing } from "@/insight/briefing-service";
import { lensParamSchema } from "@/insight/lens";
import { isCalendarDate } from "@/lib/dates";
import { logger } from "@/lib/logger";
import { cachedJson, errorJson } from "@/market/responses";
import { safeErrorMessage } from "@/server/safe-error";
import { getDb } from "@/server/services";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

/** The daily briefing for a trade date, with the glossary entries it cites. Public until invite-code auth lands. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
): Promise<Response> {
  const { date } = await params;
  if (!isCalendarDate(date)) return errorJson("invalid date", 400);
  const lens = lensParamSchema.safeParse(
    new URL(request.url).searchParams.get("lens") ?? undefined,
  );
  if (!lens.success) return errorJson("invalid lens", 400);
  try {
    const result = await getDailyBriefing(getDb(), date, lens.data);
    if (!result) return errorJson("not_found", 404);
    return cachedJson(result, CACHE, date);
  } catch (error) {
    logger.error({ error: safeErrorMessage(error) }, "daily briefing failed");
    return errorJson("internal_error", 500);
  }
}
