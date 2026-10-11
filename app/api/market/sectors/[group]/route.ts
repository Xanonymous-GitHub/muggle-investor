import { getEnv } from "@/config/env";
import { getHolidays } from "@/db/repositories/calendar";
import { logger } from "@/lib/logger";
import { getSectorDetail } from "@/market/market-service";
import { errorJson, marketJson } from "@/market/responses";
import { marketPhase, toTaipei } from "@/market-clock/market-clock";
import { safeErrorMessage } from "@/server/safe-error";
import { getDarkfanxingClient, getDb } from "@/server/services";

export const dynamic = "force-dynamic";

/**
 * Constituents of one sector, fetched from upstream on demand and cached. 404 for names the
 * latest board does not list (or that are malformed). Public until invite-code auth lands.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ group: string }> },
): Promise<Response> {
  try {
    const { group } = await params;
    const db = getDb();
    const now = new Date();
    const year = Number(toTaipei(now).date.slice(0, 4));
    const holidays = await getHolidays(db, year);
    const detail = await getSectorDetail(
      {
        db,
        darkfanxing: getDarkfanxingClient(),
        darkfanxingKey: getEnv().DARKFANXING_KEY,
        now,
        holidays,
      },
      group,
    );
    if (!detail) return errorJson("not_found", 404);
    return marketJson(detail, marketPhase(now, holidays), detail);
  } catch (error) {
    logger.error({ error: safeErrorMessage(error) }, "market sector detail failed");
    return errorJson("internal_error", 500);
  }
}
