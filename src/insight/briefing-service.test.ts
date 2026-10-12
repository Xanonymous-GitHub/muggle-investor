import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { type Briefing, saveBriefing } from "@/db/repositories/briefings";
import { briefings } from "@/db/schema";
import type { BriefingContent } from "@/insight/briefing-content";
import { createTestDb } from "../../test/helpers/test-db";
import { getDailyBriefing, getLatestBriefing, getWeeklyBriefing } from "./briefing-service";

const warn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { warn: (...args: unknown[]) => warn(...args) } }));

const content = (headline: string, termIds: string[]): BriefingContent => ({
  headline,
  summary: "加權指數收漲。",
  sections: [
    { title: "大盤", body: "今天加權指數小幅上漲。" },
    { title: "類股", body: "電子類股領漲。" },
  ],
  takeaway: "這是教育資訊，不是投資建議。",
  termIds,
});

const save = (overrides: Partial<Omit<Briefing, "createdAt">> & { headline?: string }) =>
  saveBriefing(db, {
    kind: "daily",
    periodKey: "2026-10-08",
    lens: "beginner",
    promptVersion: 1,
    model: "test-model",
    ...overrides,
    content: overrides.content ?? content(overrides.headline ?? "標題", ["force", "sector"]),
  });

let db: Db;

describe("briefing service", () => {
  beforeEach(async () => {
    warn.mockReset();
    db = await createTestDb();
  });

  describe("getLatestBriefing", () => {
    it("returns the greatest daily period with terms for exactly its termIds", async () => {
      await save({ periodKey: "2026-10-07", headline: "較舊" });
      await save({
        periodKey: "2026-10-08",
        headline: "最新",
        content: content("最新", ["force"]),
      });
      const result = await getLatestBriefing(db, "beginner");
      expect(result?.briefing.periodKey).toBe("2026-10-08");
      expect(result?.briefing.content.headline).toBe("最新");
      expect(Object.keys(result?.terms ?? {})).toEqual(["force"]);
      expect(result?.terms.force?.id).toBe("force");
    });

    it("ignores weekly briefings and selects the requested lens", async () => {
      await save({ lens: "beginner", headline: "新手" });
      await save({ lens: "pro", headline: "專業" });
      await save({ kind: "weekly", periodKey: "2026-W41", headline: "週報" });
      expect((await getLatestBriefing(db, "pro"))?.briefing.content.headline).toBe("專業");
      expect((await getLatestBriefing(db, "beginner"))?.briefing.content.headline).toBe("新手");
    });

    it("returns null when nothing is stored for the lens", async () => {
      await save({ lens: "beginner" });
      expect(await getLatestBriefing(db, "pro")).toBeNull();
    });

    it("silently drops termIds that are not in the glossary", async () => {
      await save({ content: content("標題", ["force", "no-such-term"]) });
      const result = await getLatestBriefing(db, "beginner");
      expect(Object.keys(result?.terms ?? {})).toEqual(["force"]);
    });

    it("treats a drifted latest row as not found, with one warn", async () => {
      await save({});
      await db.update(briefings).set({ content: { headline: "舊格式" } });
      expect(await getLatestBriefing(db, "beginner")).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("getDailyBriefing", () => {
    it("returns the briefing for the date and lens", async () => {
      await save({ lens: "pro", headline: "專業" });
      const result = await getDailyBriefing(db, "2026-10-08", "pro");
      expect(result?.briefing).toMatchObject({
        kind: "daily",
        periodKey: "2026-10-08",
        lens: "pro",
      });
      expect(Object.keys(result?.terms ?? {}).sort()).toEqual(["force", "sector"]);
    });

    it("returns null for an unknown date or the other lens", async () => {
      await save({});
      expect(await getDailyBriefing(db, "2026-10-09", "beginner")).toBeNull();
      expect(await getDailyBriefing(db, "2026-10-08", "pro")).toBeNull();
    });

    it("treats a drifted row as not found, with one warn", async () => {
      await save({});
      await db.update(briefings).set({ content: { headline: "舊格式" } });
      expect(await getDailyBriefing(db, "2026-10-08", "beginner")).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("still throws on a database failure", async () => {
      await expect(getDailyBriefing({} as Db, "2026-10-08", "beginner")).rejects.toThrow();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("getWeeklyBriefing", () => {
    it("returns the weekly briefing, not the daily one", async () => {
      await save({ kind: "weekly", periodKey: "2026-W41", headline: "週報" });
      const result = await getWeeklyBriefing(db, "2026-W41", "beginner");
      expect(result?.briefing).toMatchObject({ kind: "weekly", periodKey: "2026-W41" });
      expect(await getWeeklyBriefing(db, "2026-W40", "beginner")).toBeNull();
    });

    it("treats a drifted row as not found, with one warn", async () => {
      await save({ kind: "weekly", periodKey: "2026-W41" });
      await db.update(briefings).set({ content: { headline: "舊格式" } });
      expect(await getWeeklyBriefing(db, "2026-W41", "beginner")).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
