import { getEnv } from "@/config/env";
import { createDb, type Db } from "@/db/client";
import { createLlmFromEnv, type Llm } from "@/insight/llm";
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
 * FinMind allows 600 requests/hour with a token (300 without). A post-close run makes about 40-63
 * requests for the 21 tracked symbols (2 per symbol to top up, 3 per backfill, at most 3 backfills,
 * plus the weekly universe listing), which the 10/minute limiter spreads over roughly 4-6 minutes.
 */
export const getFinMindClient: () => FinMindClient = lazy(() => {
  const token = getEnv().FINMIND_TOKEN;
  return createFinMindClient({
    ...(token && { token }),
    limiter: createRateLimiter({ capacity: 10, refillEveryMs: 60_000 }),
  });
});

export const getLlm: () => Llm = lazy(() => createLlmFromEnv(getEnv()));

export const getTwseClient: () => TwseClient = lazy(() =>
  createTwseClient({ limiter: createRateLimiter({ capacity: 5, refillEveryMs: 60_000 }) }),
);
