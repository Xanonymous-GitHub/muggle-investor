import { logger } from "@/lib/logger";
import { cachedJson, errorJson } from "@/market/responses";
import { DataUnavailableError, planPortfolio } from "@/planner/plan-service";
import { planRequestSchema } from "@/planner/schema";
import { readBoundedText } from "@/server/bounded-body";
import { safeErrorMessage } from "@/server/safe-error";
import { getDb } from "@/server/services";

export const dynamic = "force-dynamic";

/** A valid request is a few hundred bytes; anything past this is rejected unread. */
const MAX_BODY_BYTES = 4096;

/** Engine errors can quote the amounts they rejected; numbers never reach the log. */
const withoutNumbers = (message: string) => message.replace(/\d+/g, "#");

/** Driver errors carry a string code (e.g. ECONNREFUSED) worth logging; anything else is dropped. */
function errorCode(error: unknown): { code: string } | Record<string, never> {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? { code } : {};
}

/**
 * A plan for one questionnaire and amounts. Stores nothing and never logs the request body.
 * Public until invite-code auth lands.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    const text = await readBoundedText(request, MAX_BODY_BYTES);
    if (text === null) return errorJson("invalid_request", 400);
    body = JSON.parse(text);
  } catch {
    return errorJson("invalid_request", 400);
  }
  const parsed = planRequestSchema.safeParse(body);
  if (!parsed.success) return errorJson("invalid_request", 400);
  try {
    const plan = await planPortfolio({ db: getDb(), now: new Date() }, parsed.data);
    return cachedJson(plan, "no-store");
  } catch (error) {
    if (error instanceof DataUnavailableError) {
      logger.error({ error: error.name }, "plan unavailable: no eligible core instrument");
      return errorJson("data_unavailable", 503);
    }
    logger.error(
      { error: withoutNumbers(safeErrorMessage(error)), ...errorCode(error) },
      "plan failed",
    );
    return errorJson("internal_error", 500);
  }
}
