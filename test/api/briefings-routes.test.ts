import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { saveBriefing } from "@/db/repositories/briefings";
import { briefings } from "@/db/schema";
import type { Lens } from "@/insight/lens";
import { createTestDb } from "../helpers/test-db";

let db: Db;
vi.mock("@/server/services", () => ({ getDb: () => db }));
vi.mock("@/lib/logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

const latest = await import("../../app/api/briefings/latest/route");
const daily = await import("../../app/api/briefings/daily/[date]/route");
const weekly = await import("../../app/api/briefings/weekly/[week]/route");

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

const callLatest = (query = "") => latest.GET(new Request(`http://x/api/briefings/latest${query}`));
const callDaily = (date: string, query = "") =>
  daily.GET(new Request(`http://x/api/briefings/daily/${date}${query}`), {
    params: Promise.resolve({ date }),
  });
const callWeekly = (week: string, query = "") =>
  weekly.GET(new Request(`http://x/api/briefings/weekly/${week}${query}`), {
    params: Promise.resolve({ week }),
  });

const content = (headline: string) => ({
  headline,
  summary: "加權指數收漲。",
  sections: [
    { title: "大盤", body: "今天加權指數小幅上漲。" },
    { title: "類股", body: "電子類股領漲。" },
  ],
  takeaway: "這是教育資訊，不是投資建議。",
  termIds: ["force", "sector"],
});

const save = (kind: "daily" | "weekly", periodKey: string, lens: Lens, headline = "標題") =>
  saveBriefing(db, {
    kind,
    periodKey,
    lens,
    promptVersion: 1,
    model: "test-model",
    content: content(headline),
  });

describe("briefing routes", () => {
  beforeEach(async () => {
    db = await createTestDb();
    await save("daily", "2026-10-07", "beginner", "較舊");
    await save("daily", "2026-10-08", "beginner", "新手");
    await save("daily", "2026-10-08", "pro", "專業");
    await save("weekly", "2026-W41", "beginner", "週報");
  });

  describe("GET /api/briefings/latest", () => {
    it("returns the latest daily for the default beginner lens with terms and headers", async () => {
      const res = await callLatest();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(CACHE);
      expect(res.headers.get("x-data-trade-date")).toBe("2026-10-08");
      const body = await res.json();
      expect(body.briefing).toMatchObject({
        kind: "daily",
        periodKey: "2026-10-08",
        lens: "beginner",
      });
      expect(body.briefing.content.headline).toBe("新手");
      expect(Object.keys(body.terms).sort()).toEqual(["force", "sector"]);
      expect(body.terms.force.term).toBeTypeOf("string");
    });

    it("selects the pro lens", async () => {
      const body = await (await callLatest("?lens=pro")).json();
      expect(body.briefing.content.headline).toBe("專業");
    });

    it.each(["?lens=expert", "?lens=", "?lens=Pro"])("rejects %s with 400", async (query) => {
      const res = await callLatest(query);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "invalid lens" });
    });

    it("answers 404 on an empty database", async () => {
      db = await createTestDb();
      const res = await callLatest();
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "not_found" });
    });

    it("answers 404, not 500, when the stored briefing no longer matches its schema", async () => {
      await db.update(briefings).set({ content: { headline: "舊格式" } });
      const res = await callLatest();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });

    it("maps an unexpected failure to 500 internal_error", async () => {
      db = {} as Db;
      const res = await callLatest();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal_error" });
    });
  });

  describe("GET /api/briefings/daily/[date]", () => {
    it("returns the briefing for the date, labelled with that date", async () => {
      const res = await callDaily("2026-10-07");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(CACHE);
      expect(res.headers.get("x-data-trade-date")).toBe("2026-10-07");
      expect((await res.json()).briefing.content.headline).toBe("較舊");
    });

    it("selects the lens", async () => {
      const body = await (await callDaily("2026-10-08", "?lens=pro")).json();
      expect(body.briefing.content.headline).toBe("專業");
    });

    it("answers 404 for an unknown date", async () => {
      const res = await callDaily("2026-10-09");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    });

    it("answers 404 when the other lens has no briefing that day", async () => {
      expect((await callDaily("2026-10-07", "?lens=pro")).status).toBe(404);
    });

    it.each(["2026-13-45", "2026-02-30", "2026-1-5", "abc", "%E2%80%A6"])(
      "rejects the date %s with 400",
      async (date) => {
        const res = await callDaily(date);
        expect(res.status).toBe(400);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual({ error: "invalid date" });
      },
    );

    it("rejects an unknown lens with 400", async () => {
      const res = await callDaily("2026-10-08", "?lens=expert");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid lens" });
    });

    it("answers 404 for a drifted row", async () => {
      await db.update(briefings).set({ content: { headline: "舊格式" } });
      expect((await callDaily("2026-10-08")).status).toBe(404);
    });

    it("maps an unexpected failure to 500", async () => {
      db = {} as Db;
      expect((await callDaily("2026-10-08")).status).toBe(500);
    });
  });

  describe("GET /api/briefings/weekly/[week]", () => {
    it("returns the weekly briefing labelled with the week's last day", async () => {
      const res = await callWeekly("2026-W41");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(CACHE);
      expect(res.headers.get("x-data-trade-date")).toBe("2026-10-11");
      const body = await res.json();
      expect(body.briefing).toMatchObject({ kind: "weekly", periodKey: "2026-W41" });
      expect(Object.keys(body.terms).sort()).toEqual(["force", "sector"]);
    });

    it("answers 404 for a real week with no briefing, and for 2026-W53 (valid, nothing stored)", async () => {
      expect((await callWeekly("2026-W40")).status).toBe(404);
      expect((await callWeekly("2026-W53")).status).toBe(404);
    });

    it.each(["2026-W99", "2027-W53", "2026-W00", "2026-W1", "2026W41", "abc"])(
      "rejects the week %s with 400",
      async (week) => {
        const res = await callWeekly(week);
        expect(res.status).toBe(400);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual({ error: "invalid week" });
      },
    );

    it("rejects an unknown lens with 400", async () => {
      expect((await callWeekly("2026-W41", "?lens=expert")).status).toBe(400);
    });

    it("answers 404 for a drifted row", async () => {
      await db.update(briefings).set({ content: { headline: "舊格式" } });
      expect((await callWeekly("2026-W41")).status).toBe(404);
    });
  });
});
