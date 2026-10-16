import { clearedSessionCookie, isSecureRequest, requireSession } from "@/ask/auth/session";
import { cachedJson, errorJson } from "@/market/responses";

export const dynamic = "force-dynamic";

/** Whether the request carries a valid session; nothing about the person is returned. */
export function GET(request: Request): Response {
  if (!requireSession(request)) return errorJson("unauthorized", 401);
  return cachedJson({ ok: true }, "no-store");
}

/** Signs out: clears the cookie whether or not there was a session. */
export function DELETE(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": clearedSessionCookie(isSecureRequest(request)),
    },
  });
}
