import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_SESSION_TTL_SECONDS,
  isSecureRequest,
  sessionCookie,
  signSession,
  subjectFor,
} from "@/ask/auth/session";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { createRateLimiter, type RateLimiter } from "@/lib/rate-limiter";
import { errorJson } from "@/market/responses";

export const dynamic = "force-dynamic";

/** A code is a short word; anything past this is rejected unread. */
const MAX_BODY_BYTES = 256;

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
/** Past this many tracked addresses, entries from finished windows are dropped. */
const PRUNE_ABOVE = 1000;

const bodySchema = z.object({ code: z.string().min(1).max(MAX_BODY_BYTES) });

type Attempts = { limiter: RateLimiter; openedAt: number };

/**
 * Attempts per client address. In memory, so the limit is per server process: it slows guessing
 * from one address, it is not a global cap. The address comes from the proxy's forwarded header;
 * without a trusted proxy it can be spoofed, which is why codes must also be long enough to resist
 * guessing.
 */
const attemptsByClient = new Map<string, Attempts>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Takes one attempt for this client; the result is the seconds to wait when none is left. */
function takeAttempt(
  client: string,
  now: number,
): { allowed: true } | { allowed: false; retryAfter: number } {
  let entry = attemptsByClient.get(client);
  if (!entry || now - entry.openedAt >= ATTEMPT_WINDOW_MS) {
    if (attemptsByClient.size >= PRUNE_ABOVE) {
      for (const [key, value] of attemptsByClient) {
        if (now - value.openedAt >= ATTEMPT_WINDOW_MS) attemptsByClient.delete(key);
      }
    }
    entry = {
      limiter: createRateLimiter({
        capacity: MAX_ATTEMPTS,
        refillEveryMs: ATTEMPT_WINDOW_MS,
        now: () => now,
      }),
      openedAt: now,
    };
    attemptsByClient.set(client, entry);
  }
  if (entry.limiter.tryAcquire()) return { allowed: true };
  return {
    allowed: false,
    retryAfter: Math.max(1, Math.ceil((entry.openedAt + ATTEMPT_WINDOW_MS - now) / 1000)),
  };
}

/** The body as text, or null when it is over the cap (declared or while reading). */
async function readBoundedText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!(declared <= MAX_BODY_BYTES)) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const digest = (text: string) => createHash("sha256").update(text).digest();

/** Compares against every configured code, in constant time, without stopping at the first match. */
function matchingCode(given: string, codes: string[]): string | null {
  const givenDigest = digest(given);
  let match: string | null = null;
  for (const code of codes) {
    if (timingSafeEqual(givenDigest, digest(code))) match = code;
  }
  return match;
}

/**
 * Exchanges an invite code for a signed session cookie. Never logs or echoes the code.
 * Every attempt counts toward the address's limit (a successful login too).
 */
export async function POST(request: Request): Promise<Response> {
  const attempt = takeAttempt(clientKey(request), Date.now());
  if (!attempt.allowed) {
    logger.warn({ error: "rate_limited" }, "invite attempt blocked");
    return errorJson("rate_limited", 429, { "retry-after": String(attempt.retryAfter) });
  }
  let code: string;
  try {
    const text = await readBoundedText(request);
    if (text === null) return errorJson("invalid_request", 400);
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return errorJson("invalid_request", 400);
    code = parsed.data.code;
  } catch {
    return errorJson("invalid_request", 400);
  }
  const env = getEnv();
  const matched = matchingCode(code, env.INVITE_CODES);
  if (matched === null) {
    logger.warn({ error: "invalid_code" }, "invite code rejected");
    return errorJson("invalid_code", 401);
  }
  const token = signSession(
    { subject: subjectFor(matched, env.AUTH_SECRET), now: new Date() },
    env.AUTH_SECRET,
  );
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": sessionCookie(token, {
        secure: isSecureRequest(request),
        maxAgeSeconds: DEFAULT_SESSION_TTL_SECONDS,
      }),
    },
  });
}
