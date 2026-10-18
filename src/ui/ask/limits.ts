// The server's Ask limits, duplicated because `src/ui` may not import `@/ask` values. The
// test next to this file compares every number with `src/ask/schema.ts`.
export const ASK_LIMITS = {
  maxMessages: 20,
  maxMessageChars: 4000,
  maxHoldings: 30,
  maxMemoryNotes: 20,
  maxMemoryChars: 200,
  /** The server answers 413 above this many UTF-8 bytes of request body. */
  maxBodyBytes: 65_536,
  /** What the client aims for, leaving room under `maxBodyBytes`. */
  clientBodyBudget: 60_000,
} as const;
