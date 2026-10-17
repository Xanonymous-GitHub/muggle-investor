import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "../../../test/helpers/test-db";
import {
  addAskTokens,
  consumeAskMessage,
  getAskUsage,
  MAX_DAILY_REFUNDS,
  refundAskMessage,
} from "./ask-usage";

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
      refunds: 0,
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
      refunds: 0,
    });
  });

  it("refunds one message, never below 0, counts the refund and keeps the token totals", async () => {
    await consumeAskMessage(db, { subject: "a", day, limit: 3 });
    await consumeAskMessage(db, { subject: "a", day, limit: 3 });
    await addAskTokens(db, { subject: "a", day, usage: { inputTokens: 7, outputTokens: 3 } });
    expect(await refundAskMessage(db, { subject: "a", day })).toBe(true);
    expect(await getAskUsage(db, "a", day)).toEqual({
      messages: 1,
      inputTokens: 7,
      outputTokens: 3,
      refunds: 1,
    });
    expect(await refundAskMessage(db, { subject: "a", day })).toBe(true);
    expect(await refundAskMessage(db, { subject: "a", day })).toBe(false);
    expect(await getAskUsage(db, "a", day)).toMatchObject({ messages: 0, refunds: 2 });
  });

  it("refunds nothing for an unknown key and creates no row", async () => {
    expect(await refundAskMessage(db, { subject: "nobody", day })).toBe(false);
    expect(await getAskUsage(db, "nobody", day)).toEqual({
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
      refunds: 0,
    });
  });

  it("frees a refunded message for the next request", async () => {
    await consumeAskMessage(db, { subject: "a", day, limit: 1 });
    expect((await consumeAskMessage(db, { subject: "a", day, limit: 1 })).allowed).toBe(false);
    await refundAskMessage(db, { subject: "a", day });
    expect((await consumeAskMessage(db, { subject: "a", day, limit: 1 })).allowed).toBe(true);
  });

  it(`applies at most MAX_DAILY_REFUNDS (${MAX_DAILY_REFUNDS}) refunds a day; the next one is not applied`, async () => {
    expect(MAX_DAILY_REFUNDS).toBe(5);
    for (let i = 0; i < 10; i++) await consumeAskMessage(db, { subject: "a", day, limit: 30 });
    for (let i = 0; i < MAX_DAILY_REFUNDS; i++) {
      expect(await refundAskMessage(db, { subject: "a", day })).toBe(true);
    }
    expect(await refundAskMessage(db, { subject: "a", day })).toBe(false);
    expect(await getAskUsage(db, "a", day)).toMatchObject({ messages: 5, refunds: 5 });
    // The cap is per day: the next day starts afresh.
    await consumeAskMessage(db, { subject: "a", day: "2026-10-18", limit: 30 });
    expect(await refundAskMessage(db, { subject: "a", day: "2026-10-18" })).toBe(true);
  });

  it("keeps the floor and the cap under concurrent refunds", async () => {
    await consumeAskMessage(db, { subject: "a", day, limit: 30 });
    await consumeAskMessage(db, { subject: "a", day, limit: 30 });
    await Promise.all(Array.from({ length: 8 }, () => refundAskMessage(db, { subject: "a", day })));
    expect(await getAskUsage(db, "a", day)).toMatchObject({ messages: 0, refunds: 2 });

    for (let i = 0; i < 10; i++) await consumeAskMessage(db, { subject: "b", day, limit: 30 });
    const applied = await Promise.all(
      Array.from({ length: 12 }, () => refundAskMessage(db, { subject: "b", day })),
    );
    expect(applied.filter(Boolean)).toHaveLength(MAX_DAILY_REFUNDS);
    expect(await getAskUsage(db, "b", day)).toMatchObject({ messages: 5, refunds: 5 });
  });

  it("reports zeros for an unknown key", async () => {
    expect(await getAskUsage(db, "nobody", day)).toEqual({
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
      refunds: 0,
    });
  });
});
