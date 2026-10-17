import { AskUnavailableError, streamAnswer } from "@/ask/ask-service";
import { requireSession } from "@/ask/auth/session";
import { safeCode } from "@/ask/safe-code";
import { askRequestSchema, MAX_ASK_BODY_BYTES } from "@/ask/schema";
import { getEnv } from "@/config/env";
import { consumeAskMessage } from "@/db/repositories/ask-usage";
import { logger } from "@/lib/logger";
import { errorJson } from "@/market/responses";
import { toTaipei } from "@/market-clock/market-clock";
import { readBoundedText } from "@/server/bounded-body";
import { getAskModel, getDb } from "@/server/services";

export const dynamic = "force-dynamic";

const DAY_SECONDS = 24 * 60 * 60;
const TAIPEI_OFFSET_SECONDS = 8 * 60 * 60;

/** Seconds until the next midnight in Taipei (UTC+8, no daylight saving), at least 1. */
function secondsToTaipeiMidnight(now: Date): number {
  const taipeiSeconds = Math.floor(now.getTime() / 1000) + TAIPEI_OFFSET_SECONDS;
  return DAY_SECONDS - (((taipeiSeconds % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS);
}

/**
 * Error name and code only. Messages can quote input (schema paths, provider echoes of the
 * prompt), and nothing from the request may reach the log.
 */
function failure(error: unknown): { error: string; code?: string } {
  const name = error instanceof Error ? error.name : "unknown";
  const code = safeCode(error) ?? safeCode((error as { cause?: unknown } | null)?.cause);
  return { error: name, ...(code && { code }) };
}

/**
 * Streams an Ask answer for a signed-in person. Order matters: session, size, shape, then the
 * daily quota, so a rejected request never spends a message. Never logs or echoes the body.
 */
export async function POST(request: Request): Promise<Response> {
  const now = new Date();
  const session = requireSession(request, now);
  if (!session) return errorJson("unauthorized", 401);

  let body: unknown;
  try {
    const text = await readBoundedText(request, MAX_ASK_BODY_BYTES);
    if (text === null) return errorJson("too_large", 413);
    body = JSON.parse(text);
  } catch {
    return errorJson("invalid_request", 400);
  }
  // Only success is read: issues carry paths and values from the input.
  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) return errorJson("invalid_request", 400);

  try {
    const env = getEnv();
    const db = getDb();
    const limit = env.ASK_DAILY_MESSAGE_LIMIT;
    const quota = await consumeAskMessage(db, {
      subject: session.subject,
      day: toTaipei(now).date,
      limit,
    });
    if (!quota.allowed) {
      return errorJson("rate_limited", 429, {
        "retry-after": String(secondsToTaipeiMidnight(now)),
        "x-ask-limit": String(limit),
        "x-ask-used": String(quota.used),
      });
    }
    const { model, modelId } = getAskModel();
    return await streamAnswer(
      {
        db,
        model,
        modelId,
        env,
        processEnv: process.env,
        now,
        logger,
        abortSignal: request.signal,
      },
      parsed.data,
      session.subject,
    );
  } catch (error) {
    if (error instanceof AskUnavailableError) return errorJson("llm_unavailable", 503);
    logger.error(failure(error), "ask failed");
    return errorJson("internal_error", 500);
  }
}
