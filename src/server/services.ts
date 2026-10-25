import type { LanguageModel } from "ai";
import { capabilityKey } from "@/ask/capability";
import { createScopeGuard, GUARD_MAX_OUTPUT_TOKENS, type ScopeGuard } from "@/ask/guard/scope";
import { baseUrlHint, describeEndpoint } from "@/ask/provider-failure";
import { getEnv } from "@/config/env";
import { createDb, type Db } from "@/db/client";
import { createLlm, createLlmFromEnv, createModelFromEnv, type Llm } from "@/insight/llm";
import { logger } from "@/lib/logger";
import { createRateLimiter } from "@/lib/rate-limiter";
import {
  createDarkfanxingClient,
  createDarkfanxingLimiter,
  type DarkfanxingClient,
} from "@/sources/darkfanxing";
import { createFinMindClient, type FinMindClient } from "@/sources/finmind";
import { createTwseClient, type TwseClient } from "@/sources/twse";

// Server-only: process-wide singletons built lazily from the validated env. Every route that
// talks to the database or an upstream must go through these, so the darkfanxing quota is
// enforced by ONE limiter per process and the database pool is shared.

const lazy = <T>(build: () => T): (() => T) => {
  let value: T | undefined;
  return () => {
    value ??= build();
    return value;
  };
};

export const getDb: () => Db = lazy(() => createDb(getEnv().DATABASE_URL));

export const getDarkfanxingClient: () => DarkfanxingClient = lazy(() => {
  const env = getEnv();
  return createDarkfanxingClient({
    baseUrl: env.DARKFANXING_BASE_URL,
    key: env.DARKFANXING_KEY,
    limiter: createDarkfanxingLimiter(),
  });
});

/**
 * FinMind allows 600 requests/hour with a token (300 without). Refreshing the 21 tracked symbols
 * takes 63-73 requests (3 per symbol whether top-up or backfill, at most 3 backfills, plus the
 * weekly universe listing), about 6-7 minutes at this 10/minute limiter, so a run stops starting
 * symbols after `PRICE_RUN_BUDGET_MS` and the post-close runs share the refresh.
 */
export const getFinMindClient: () => FinMindClient = lazy(() => {
  const token = getEnv().FINMIND_TOKEN;
  return createFinMindClient({
    ...(token && { token }),
    limiter: createRateLimiter({ capacity: 10, refillEveryMs: 60_000 }),
  });
});

export const getLlm: () => Llm = lazy(() => createLlmFromEnv(getEnv()));

/** The model the Ask route streams from, with its id for usage rows. */
export const getAskModel: () => {
  model: LanguageModel;
  modelId: string;
  capabilityKey: string;
} = lazy(() => {
  const env = getEnv();
  const hint = baseUrlHint(env.LLM_BASE_URL);
  logger.debug(
    { endpoint: describeEndpoint(env.LLM_BASE_URL), model: env.LLM_MODEL, ...(hint && { hint }) },
    "ask model configured",
  );
  return {
    model: createModelFromEnv(env),
    modelId: env.LLM_MODEL,
    capabilityKey: capabilityKey(env),
  };
});

/**
 * The Ask input gate, or undefined with `ASK_GUARD=off`. Its own model instance and a short
 * deadline: a slow classifier must not hold an answer for as long as a slow answer may take.
 */
export const getAskGuard: () => ScopeGuard | undefined = lazy(() => {
  const env = getEnv();
  if (env.ASK_GUARD === "off") return undefined;
  const modelId = env.ASK_GUARD_MODEL ?? env.LLM_MODEL;
  return createScopeGuard(
    createLlm({
      model: createModelFromEnv({ ...env, LLM_MODEL: modelId }),
      modelId,
      mode: env.LLM_STRUCTURED_OUTPUT,
      timeoutMs: env.ASK_GUARD_TIMEOUT_MS,
      maxOutputTokens: GUARD_MAX_OUTPUT_TOKENS,
    }),
  );
});

export const getTwseClient: () => TwseClient = lazy(() =>
  createTwseClient({ limiter: createRateLimiter({ capacity: 5, refillEveryMs: 60_000 }) }),
);
