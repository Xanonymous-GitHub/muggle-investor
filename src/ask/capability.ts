/**
 * What the Ask service remembers about the model endpoint it talks to: that it refused tool
 * definitions. The memory is keyed by the endpoint's identity (API flavour, base URL without
 * credentials, model), so changing the model or the API mode never inherits a verdict that was
 * about a different endpoint, and a rejection by one never switches tools off for another.
 * Process-local and short-lived: after the TTL the endpoint is simply tried again.
 */
import type { Env } from "@/config/env";

/** How long a confirmed "this endpoint does not support tools" is trusted before tools are tried again. */
export const TOOLS_REJECTION_TTL_MS = 10 * 60 * 1000;

/** `responses|https://host/v1|model`: no key, no query string, no user info. */
export function capabilityKey(env: Pick<Env, "LLM_API" | "LLM_BASE_URL" | "LLM_MODEL">): string {
  let base = env.LLM_BASE_URL;
  try {
    const url = new URL(env.LLM_BASE_URL);
    base = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    // An unparseable base URL still keys the memory, just less tidily.
  }
  return `${env.LLM_API}|${base}|${env.LLM_MODEL}`;
}

/** When each endpoint last rejected tools AND then answered without them, by capability key. */
const toolsRejectedAt = new Map<string, number>();

/** Whether `key` rejected tools recently enough (by the request's clock) that tools are skipped. */
export function toolsRecentlyRejected(key: string, nowMs: number): boolean {
  const at = toolsRejectedAt.get(key);
  if (at === undefined) return false;
  if (nowMs - at < TOOLS_REJECTION_TTL_MS) return true;
  toolsRejectedAt.delete(key);
  return false;
}

export function rememberToolsRejected(key: string, nowMs: number): void {
  toolsRejectedAt.set(key, nowMs);
}

/** Forgets every remembered rejection. For tests. */
export function resetToolSupport(): void {
  toolsRejectedAt.clear();
}
