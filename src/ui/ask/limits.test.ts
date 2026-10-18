import { describe, expect, it } from "vitest";
import {
  MAX_ASK_BODY_BYTES,
  MAX_HOLDINGS,
  MAX_MEMORY_CHARS,
  MAX_MEMORY_NOTES,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
} from "@/ask/schema";
import { ASK_LIMITS } from "@/ui/ask/limits";

describe("ASK_LIMITS", () => {
  it("matches the server schema", () => {
    expect(ASK_LIMITS.maxMessages).toBe(MAX_MESSAGES);
    expect(ASK_LIMITS.maxMessageChars).toBe(MAX_MESSAGE_CHARS);
    expect(ASK_LIMITS.maxHoldings).toBe(MAX_HOLDINGS);
    expect(ASK_LIMITS.maxMemoryNotes).toBe(MAX_MEMORY_NOTES);
    expect(ASK_LIMITS.maxMemoryChars).toBe(MAX_MEMORY_CHARS);
    expect(ASK_LIMITS.maxBodyBytes).toBe(MAX_ASK_BODY_BYTES);
  });

  it("keeps the client budget under the server cap", () => {
    expect(ASK_LIMITS.clientBodyBudget).toBeLessThan(ASK_LIMITS.maxBodyBytes);
  });
});
