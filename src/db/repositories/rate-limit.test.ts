import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { rateLimitWindow } from "@/db/schema";
import { createTestDb } from "../../../test/helpers/test-db";
import { takeRateLimitToken } from "./rate-limit";

const WINDOW_MS = 60_000;

describe("shared rate limit repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("grants tokens up to the capacity, then refuses with the time left in the window", async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        await takeRateLimitToken(db, { source: "s", capacity: 3, windowMs: WINDOW_MS }),
      ).toEqual({
        ok: true,
      });
    }
    const refused = await takeRateLimitToken(db, { source: "s", capacity: 3, windowMs: WINDOW_MS });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.retryAfterMs).toBeGreaterThan(0);
      expect(refused.retryAfterMs).toBeLessThanOrEqual(WINDOW_MS);
    }
  });

  it("does not raise the count when it refuses", async () => {
    for (let i = 0; i < 5; i++) {
      await takeRateLimitToken(db, { source: "s", capacity: 2, windowMs: WINDOW_MS });
    }
    const rows = await db.select().from(rateLimitWindow);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.used).toBe(2);
  });

  it("shares one budget between callers, as two pods on one database do", async () => {
    const pod = () => takeRateLimitToken(db, { source: "s", capacity: 10, windowMs: WINDOW_MS });
    const results = await Promise.all(Array.from({ length: 25 }, pod));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
  });

  it("opens a new window once the previous one has ended", async () => {
    const take = () => takeRateLimitToken(db, { source: "s", capacity: 1, windowMs: 150 });
    expect((await take()).ok).toBe(true);
    expect((await take()).ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await take()).ok).toBe(true);
    expect((await take()).ok).toBe(false);
  });

  it("keeps sources apart", async () => {
    expect(
      (await takeRateLimitToken(db, { source: "a", capacity: 1, windowMs: WINDOW_MS })).ok,
    ).toBe(true);
    expect(
      (await takeRateLimitToken(db, { source: "a", capacity: 1, windowMs: WINDOW_MS })).ok,
    ).toBe(false);
    expect(
      (await takeRateLimitToken(db, { source: "b", capacity: 1, windowMs: WINDOW_MS })).ok,
    ).toBe(true);
  });
});
