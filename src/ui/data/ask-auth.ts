// The invite-code session endpoints of the Ask backend (app/api/auth/*). The session is an
// HttpOnly cookie the browser handles itself; nothing here stores, caches or logs a code.

export type AskSession = "signed_in" | "signed_out" | "error";
export type InviteResult = "ok" | "invalid" | "throttled" | "error";

const INVITE_URL = "/api/auth/invite";
const SESSION_URL = "/api/auth/session";

/** An `AbortError`, or any error after the caller's signal aborted: the caller cancelled, nothing failed. */
const cancelled = (error: unknown, signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");

/** Whether the browser holds a valid session: 200 in, 401 out, anything else (or offline) is an error. */
export async function getAskSession(signal?: AbortSignal): Promise<AskSession> {
  try {
    const response = await fetch(SESSION_URL, { cache: "no-store", signal });
    if (response.status === 200) return "signed_in";
    return response.status === 401 ? "signed_out" : "error";
  } catch (error) {
    if (cancelled(error, signal)) throw error;
    return "error";
  }
}

/** Exchanges a code for the session cookie: 204 ok, 401 wrong code, 429 too many wrong codes. */
export async function postInvite(code: string, signal?: AbortSignal): Promise<InviteResult> {
  try {
    const response = await fetch(INVITE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
      signal,
    });
    if (response.status === 204) return "ok";
    if (response.status === 401) return "invalid";
    return response.status === 429 ? "throttled" : "error";
  } catch (error) {
    if (cancelled(error, signal)) throw error;
    return "error";
  }
}

/** Clears the session cookie; false when the server could not be reached or refused. */
export async function deleteAskSession(): Promise<boolean> {
  try {
    const response = await fetch(SESSION_URL, { method: "DELETE", cache: "no-store" });
    return response.status === 204;
  } catch {
    return false;
  }
}
