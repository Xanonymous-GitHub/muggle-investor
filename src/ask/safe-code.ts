// Error codes that are safe to log. A thrown error's message can carry SQL, paths, URLs or
// header values; its `code` (a Postgres or Node code such as "23505" or "ECONNRESET") cannot,
// provided it is short and made of code characters only.

/** An error code worth logging; anything else could carry text. */
export const SAFE_CODE = /^[A-Za-z0-9_.-]{1,32}$/;

/** The error's string `code` when it is well formed, else undefined. */
export function safeCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && SAFE_CODE.test(code) ? code : undefined;
}
