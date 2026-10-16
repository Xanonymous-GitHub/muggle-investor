import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "../../../test/helpers/test-db";
import { addAskTokens, consumeAskMessage, getAskUsage } from "./ask-usage";

const day = "2026-10-17";

describe("ask usage repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("allows the first message and counts it", async () => {
    expect(await consumeAskMessage(db, { subject: "a", day, limit: 3 })).toEqual({
      allowed: true,
      used: 1,
    });
  });

  it("allows up to the limit, then refuses without raising the count", async () => {
    for (let i = 1; i <= 3; i++) {
      expect(await consumeAskMessage(db, { subject: "a", day, limit: 3 })).toEqual({
        allowed: true,
        used: i,
      });
    }
    expect(await consumeAskMessage(db, { subject: "a", day, limit: 3 })).toEqual({
      allowed: false,
      used: 3,
    });
    expect((await getAskUsage(db, "a", day)).messages).toBe(3);
  });

  it("lets exactly `limit` of 50 concurrent calls through", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => consumeAskMessage(db, { subject: "a", day, limit: 10 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect((await getAskUsage(db, "a", day)).messages).toBe(10);
  });

  it("starts fresh for another subject and another day", async () => {
    await consumeAskMessage(db, { subject: "a", day, limit: 1 });
    expect(await consumeAskMessage(db, { subject: "b", day, limit: 1 })).toEqual({
      allowed: true,
      used: 1,
    });
    expect(await consumeAskMessage(db, { subject: "a", day: "2026-10-18", limit: 1 })).toEqual({
      allowed: true,
      used: 1,
    });
  });

  it("accumulates tokens and treats null as 0", async () => {
    await addAskTokens(db, { subject: "a", day, usage: { inputTokens: 100, outputTokens: 10 } });
    await addAskTokens(db, { subject: "a", day, usage: { inputTokens: null, outputTokens: 5 } });
    await addAskTokens(db, { subject: "a", day, usage: { inputTokens: 7, outputTokens: null } });
    expect(await getAskUsage(db, "a", day)).toEqual({
      messages: 0,
      inputTokens: 107,
      outputTokens: 15,
    });
  });

  it("keeps the message count when tokens are added after consuming", async () => {
    await consumeAskMessage(db, { subject: "a", day, limit: 5 });
    await addAskTokens(db, { subject: "a", day, usage: { inputTokens: 1, outputTokens: 2 } });
    await consumeAskMessage(db, { subject: "a", day, limit: 5 });
    expect(await getAskUsage(db, "a", day)).toEqual({
      messages: 2,
      inputTokens: 1,
      outputTokens: 2,
    });
  });

  it("reports zeros for an unknown key", async () => {
    expect(await getAskUsage(db, "nobody", day)).toEqual({
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});
