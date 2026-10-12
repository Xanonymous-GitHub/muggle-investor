import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { saveSnapshot } from "@/db/repositories/snapshots";
import { parseDigest } from "@/sources/darkfanxing";
import { createTestDb } from "../helpers/test-db";

let db: Db;
vi.mock("@/server/services", () => ({ getDb: () => db }));
vi.mock("@/lib/logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

const { GET } = await import("../../app/api/market/recap/route");

const DIGEST = parseDigest(
  readFileSync("test/fixtures/darkfanxing/digest-2026-10-08.html", "utf8"),
);

const call = (query: string) => GET(new Request(`http://x/api/market/recap${query}`));

describe("GET /api/market/recap", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T03:00:00Z"));
    db = await createTestDb();
    await saveSnapshot(db, {
      kind: "digest",
      groupName: null,
      tradeDate: "2026-10-08",
      asOf: null,
      session: "closed",
      capturedAt: new Date("2026-10-08T07:00:00Z"),
      rawHtml: "<html></html>",
      parsed: DIGEST,
      parseError: null,
      parserVersion: 1,
    });
  });

  it.each([
    ["", "missing"],
    ["?since=abc", "not a date"],
    ["?since=2026-13-45", "impossible month"],
    ["?since=2026-02-30", "impossible day"],
    ["?since=2026-1-5", "unpadded"],
  ])("rejects %s (%s) with 400 invalid since", async (query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "invalid since" });
  });

  it("rejects a since later than today in Taipei", async () => {
    const res = await call("?since=2999-01-01");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "since in the future" });
    expect((await call("?since=2026-10-13")).status).toBe(400);
  });

  it("accepts today's Taipei date as since", async () => {
    const res = await call("?since=2026-10-12");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "up-to-date", latestTradeDate: "2026-10-08" });
  });

  it("returns the recap with the data date header", async () => {
    const res = await call("?since=2026-10-05");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-data-trade-date")).toBe("2026-10-08");
    expect(res.headers.get("x-data-as-of")).toBeNull();
    const body = await res.json();
    expect(body).toMatchObject({
      kind: "recap",
      from: "2026-10-08",
      to: "2026-10-08",
      truncated: false,
      missedTradingDays: 1,
      weeks: [],
    });
    expect(body.days).toHaveLength(1);
  });

  it("returns up-to-date without a data date header on an empty database", async () => {
    db = await createTestDb();
    const res = await call("?since=2026-10-05");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-data-trade-date")).toBeNull();
    expect(await res.json()).toEqual({ kind: "up-to-date", latestTradeDate: null });
  });

  it("maps an unexpected failure to 500 internal_error", async () => {
    db = {} as Db;
    const res = await call("?since=2026-10-05");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});
