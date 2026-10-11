import { logger } from "@/lib/logger";
import { currentPhase, getSectorBoard } from "@/market/market-service";
import { errorJson, marketJson } from "@/market/responses";
import { safeErrorMessage } from "@/server/safe-error";
import { getDb } from "@/server/services";

export const dynamic = "force-dynamic";

/** The freshest sector board. Public until invite-code auth lands. */
export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    const [board, phase] = await Promise.all([getSectorBoard(db), currentPhase(db, new Date())]);
    if (!board) return errorJson("not_found", 404);
    return marketJson(board, phase, board);
  } catch (error) {
    logger.error({ error: safeErrorMessage(error) }, "market sectors failed");
    return errorJson("internal_error", 500);
  }
}
