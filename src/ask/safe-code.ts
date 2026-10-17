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

const MAX_CAUSE_DEPTH = 3;

/**
 * The first well-formed code on the error or on up to three `cause` levels below it: wrappers
 * (the database layer, fetch, the AI SDK) bury the useful code, e.g. APICallError → TypeError
 * → ECONNREFUSED.
 */
export function safeCauseCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    const code = safeCode(current);
    if (code) return code;
    current = (current as { cause?: unknown } | null)?.cause;
    if (current === undefined || current === null) return undefined;
  }
  return undefined;
}
