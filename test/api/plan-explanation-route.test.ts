import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { savePlanExplanation } from "@/db/repositories/plan-explanations";
import { planExplanations } from "@/db/schema";
import type { Lens } from "@/insight/lens";
import { createTestDb } from "../helpers/test-db";

let db: Db;
vi.mock("@/server/services", () => ({ getDb: () => db }));
vi.mock("@/lib/logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

const route = await import("../../app/api/plan/explanation/route");

const CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

const call = (query = "") => route.GET(new Request(`http://x/api/plan/explanation${query}`));

const save = (level: 1 | 2 | 3 | 4 | 5, lens: Lens, headline = "標題") =>
  savePlanExplanation(db, {
    level,
    lens,
    periodKey: "2026-W41",
    promptVersion: 1,
    model: "test-model",
    factsFingerprint: "secret-fingerprint",
    content: {
      headline,
      summary: "這個等級以債券為主。",
      sections: [
        { title: "組成", body: "債券比重較高。" },
        { title: "風險", body: "股票比重較低。" },
      ],
      takeaway: "以上為資料整理與教育說明，不構成投資建議。",
      termIds: ["force", "no-such-term"],
    },
  });

describe("GET /api/plan/explanation", () => {
  beforeEach(async () => {
    db = await createTestDb();
    await save(2, "beginner", "新手");
    await save(2, "pro", "專業");
  });

  it("returns the stored explanation for the level with terms and the cache header", async () => {
    const res = await call("?level=2");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CACHE);
    expect(res.headers.get("x-data-trade-date")).toBeNull();
    const body = await res.json();
    expect(body.explanation).toMatchObject({
      level: 2,
      lens: "beginner",
      periodKey: "2026-W41",
      promptVersion: 1,
      model: "test-model",
    });
    expect(body.explanation.content.headline).toBe("新手");
    expect(body.explanation.createdAt).toBeTypeOf("string");
    expect(Object.keys(body.terms)).toEqual(["force"]);
    expect(body.terms.force.term).toBeTypeOf("string");
  });

  it("does not expose the internal facts fingerprint", async () => {
    const text = await (await call("?level=2")).text();
    expect(text).not.toContain("factsFingerprint");
    expect(text).not.toContain("secret-fingerprint");
    const body = JSON.parse(text);
    expect(Object.keys(body.explanation).sort()).toEqual([
      "content",
      "createdAt",
      "lens",
      "level",
      "model",
      "periodKey",
      "promptVersion",
    ]);
  });

  it("selects the pro lens", async () => {
    const body = await (await call("?level=2&lens=pro")).json();
    expect(body.explanation.content.headline).toBe("專業");
  });

  it.each([
    "",
    "?lens=pro",
    "?level=",
    "?level=0",
    "?level=6",
    "?level=1.5",
    "?level=01",
    "?level=abc",
    "?level=-1",
    "?level=%202",
  ])("rejects the level query %j with 400", async (query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "invalid level" });
  });

  it.each(["?level=2&lens=expert", "?level=2&lens=", "?level=2&lens=Pro"])(
    "rejects %s with 400 invalid lens",
    async (query) => {
      const res = await call(query);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid lens" });
    },
  );

  it("answers 404 when nothing is stored for the level", async () => {
    const res = await call("?level=3");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("answers 404, not 500, for a drifted row", async () => {
    await db.update(planExplanations).set({ content: { headline: "舊格式" } });
    const res = await call("?level=2");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("maps an unexpected failure to 500 internal_error", async () => {
    db = {} as Db;
    const res = await call("?level=2");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});
