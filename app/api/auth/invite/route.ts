import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createInviteThrottle } from "@/ask/auth/invite-throttle";
import {
  DEFAULT_SESSION_TTL_SECONDS,
  isSecureRequest,
  sessionCookie,
  signSession,
  subjectFor,
} from "@/ask/auth/session";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { errorJson } from "@/market/responses";

export const dynamic = "force-dynamic";

/** A code is a short word; anything past this is rejected unread. */
const MAX_BODY_BYTES = 256;

const bodySchema = z.object({ code: z.string().min(1).max(MAX_BODY_BYTES) });

const throttle = createInviteThrottle();

/**
 * The client address for throttling: `x-real-ip` if the proxy sets it, else the right-most
 * `x-forwarded-for` hop (the one the nearest proxy appended; earlier hops are client-controlled),
 * else one shared bucket. Without a trusted proxy in front the header can be spoofed, so the
 * throttle is best-effort: codes must be long and random (16+ characters), not rely on it.
 */
function clientKey(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = request.headers.get("x-forwarded-for")?.split(",");
  return hops?.at(-1)?.trim() || "unknown";
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
 * Only wrong codes (401) count toward an address's limit: after 5 in 10 minutes it gets 429 for
 * every request, the right code included, until the window ends. Successes and malformed bodies
 * (400) are not counted.
 */
export async function POST(request: Request): Promise<Response> {
  const client = clientKey(request);
  const verdict = throttle.check(client);
  if (verdict.blocked) {
    logger.warn({ error: "rate_limited" }, "invite attempt blocked");
    return errorJson("rate_limited", 429, { "retry-after": String(verdict.retryAfterSeconds) });
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
    throttle.recordFailure(client);
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
