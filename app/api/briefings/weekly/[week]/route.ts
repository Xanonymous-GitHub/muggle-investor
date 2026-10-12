import { getWeeklyBriefing } from "@/insight/briefing-service";
import { lensParamSchema } from "@/insight/lens";
import { weekRange } from "@/insight/week";
import { logger } from "@/lib/logger";
import { cachedJson, errorJson } from "@/market/responses";
import { safeErrorMessage } from "@/server/safe-error";
import { getDb } from "@/server/services";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";
const WEEK_KEY = /^\d{4}-W\d{2}$/;

/** The week's last day, or null when `week` is not an existing ISO week (2026-W99, 2027-W53). */
function lastDayOf(week: string): string | null {
  if (!WEEK_KEY.test(week)) return null;
  try {
    return weekRange(week).to;
  } catch {
    return null;
  }
}

/** The weekly briefing for an ISO week, with the glossary entries it cites. Public until invite-code auth lands. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ week: string }> },
): Promise<Response> {
  const { week } = await params;
  const lastDay = lastDayOf(week);
  if (lastDay === null) return errorJson("invalid week", 400);
  const lens = lensParamSchema.safeParse(
    new URL(request.url).searchParams.get("lens") ?? undefined,
  );
  if (!lens.success) return errorJson("invalid lens", 400);
  try {
    const result = await getWeeklyBriefing(getDb(), week, lens.data);
    if (!result) return errorJson("not_found", 404);
    return cachedJson(result, CACHE, lastDay);
  } catch (error) {
    logger.error({ error: safeErrorMessage(error) }, "weekly briefing failed");
    return errorJson("internal_error", 500);
  }
}
