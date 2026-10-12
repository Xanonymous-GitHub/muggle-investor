import { daysBetween } from "@/ingestion/shift-date";
import { isCalendarDate } from "@/lib/dates";
import { logger } from "@/lib/logger";
import { currentPhase } from "@/market/market-service";
import { errorJson, marketJson } from "@/market/responses";
import { toTaipei } from "@/market-clock/market-clock";
import { getRecap } from "@/recap/recap-service";
import { safeErrorMessage } from "@/server/safe-error";
import { getDb } from "@/server/services";

export const dynamic = "force-dynamic";

/** What happened after `since`, the last trade date the client saw. Public until invite-code auth lands. */
export async function GET(request: Request): Promise<Response> {
  const since = new URL(request.url).searchParams.get("since");
  if (since === null || !isCalendarDate(since)) return errorJson("invalid since", 400);
  const now = new Date();
  if (daysBetween(toTaipei(now).date, since) > 0) return errorJson("since in the future", 400);
  try {
    const db = getDb();
    const [recap, phase] = await Promise.all([getRecap(db, { since, now }), currentPhase(db, now)]);
    const latest = recap.kind === "recap" ? recap.to : recap.latestTradeDate;
    return marketJson(recap, phase, latest ? { tradeDate: latest, asOf: null } : null);
  } catch (error) {
    logger.error({ error: safeErrorMessage(error) }, "market recap failed");
    return errorJson("internal_error", 500);
  }
}
