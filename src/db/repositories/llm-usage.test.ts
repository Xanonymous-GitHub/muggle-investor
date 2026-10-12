import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "../../../test/helpers/test-db";
import { recordLlmUsage, sumLlmUsage } from "./llm-usage";

describe("llm usage repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("sums zero for an empty table", async () => {
    expect(await sumLlmUsage(db, new Date("2026-10-01T00:00:00Z"))).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("ignores rows before `since` and treats null tokens as 0", async () => {
    const row = { purpose: "briefing", model: "m" };
    await recordLlmUsage(db, {
      ...row,
      usage: { inputTokens: 100, outputTokens: 10 },
      createdAt: new Date("2026-09-30T23:59:59Z"),
    });
    await recordLlmUsage(db, {
      ...row,
      usage: { inputTokens: 200, outputTokens: 20 },
      createdAt: new Date("2026-10-01T00:00:00Z"),
    });
    await recordLlmUsage(db, {
      ...row,
      usage: { inputTokens: null, outputTokens: 5 },
      createdAt: new Date("2026-10-02T00:00:00Z"),
    });
    await recordLlmUsage(db, {
      ...row,
      usage: { inputTokens: 7, outputTokens: null },
      createdAt: new Date("2026-10-03T00:00:00Z"),
    });
    expect(await sumLlmUsage(db, new Date("2026-10-01T00:00:00Z"))).toEqual({
      calls: 3,
      inputTokens: 207,
      outputTokens: 25,
    });
  });

  it("defaults createdAt to the database clock when omitted", async () => {
    await recordLlmUsage(db, {
      purpose: "briefing",
      model: "m",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect((await sumLlmUsage(db, new Date("2000-01-01T00:00:00Z"))).calls).toBe(1);
  });
});
