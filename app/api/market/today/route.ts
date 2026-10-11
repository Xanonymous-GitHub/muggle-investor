import { logger } from "@/lib/logger";
import { currentPhase, getToday } from "@/market/market-service";
import { errorJson, marketJson } from "@/market/responses";
import { safeErrorMessage } from "@/server/safe-error";
import { getDb } from "@/server/services";

export const dynamic = "force-dynamic";

/** Latest closed digest plus the freshest sector board. Public until invite-code auth lands. */
export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    const [today, phase] = await Promise.all([getToday(db), currentPhase(db, new Date())]);
    return marketJson(today, phase, today.board ?? today.digest);
  } catch (error) {
    logger.error({ error: safeErrorMessage(error) }, "market today failed");
    return errorJson("internal_error", 500);
  }
}
