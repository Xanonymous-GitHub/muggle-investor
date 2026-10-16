import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/config/env";

// Server-only: holds the signing logic for the invite-code session cookie.

export const SESSION_COOKIE = "muggle_session";
export const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data);

/** Equal-length comparison in constant time; unequal lengths are not secret (both are public sizes). */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * A stable, non-reversible id for the person behind an invite code. It keys the daily quota and
 * rides in the cookie, so the code itself never leaves the server after login.
 */
export function subjectFor(code: string, secret: string): string {
  return hmac(secret, code).digest("hex").slice(0, 32);
}

/** `base64url({ s: subject, e: expiry in epoch seconds }) . base64url(HMAC-SHA256(secret, payload))`. */
export function signSession(
  input: { subject: string; now: Date; ttlSeconds?: number },
  secret: string,
): string {
  const expires =
    Math.floor(input.now.getTime() / 1000) + (input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS);
  const payload = Buffer.from(JSON.stringify({ s: input.subject, e: expires })).toString(
    "base64url",
  );
  return `${payload}.${hmac(secret, payload).digest("base64url")}`;
}

function readPayload(payload: string): { s: string; e: number } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { s, e } = parsed as { s?: unknown; e?: unknown };
    return typeof s === "string" && typeof e === "number" && Number.isFinite(e) ? { s, e } : null;
  } catch {
    return null;
  }
}

/**
 * The session's subject, or null for a malformed, tampered, expired or revoked token. Revoked
 * means the subject no longer matches any code in `codes` (the code was removed from INVITE_CODES).
 */
export function verifySession(
  token: string | null,
  input: { secret: string; codes: string[]; now: Date },
): { subject: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  // Compare the canonical encoding as text: decoding first would let trailing padding bits slip through.
  if (!safeEqual(signature, hmac(input.secret, payload).digest("base64url"))) return null;
  const claims = readPayload(payload);
  if (!claims || Math.floor(input.now.getTime() / 1000) >= claims.e) return null;
  // Visit every code so the time taken does not reveal which one matched.
  let known = false;
  for (const code of input.codes) {
    if (safeEqual(claims.s, subjectFor(code, input.secret))) known = true;
  }
  return known ? { subject: claims.s } : null;
}

const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; SameSite=Lax";

export function sessionCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds: number },
): string {
  return `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${options.maxAgeSeconds}${options.secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0${secure ? "; Secure" : ""}`;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq !== -1 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
}

/** The signed-in person for this request, or null (no cookie, bad, expired or revoked). */
export function requireSession(
  request: Request,
  now: Date = new Date(),
): { subject: string } | null {
  const env = getEnv();
  return verifySession(cookieValue(request.headers.get("cookie"), SESSION_COOKIE), {
    secret: env.AUTH_SECRET,
    codes: env.INVITE_CODES,
    now,
  });
}

/** True for https requests (directly or as reported by the proxy in front) and in production. */
export function isSecureRequest(request: Request): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}
