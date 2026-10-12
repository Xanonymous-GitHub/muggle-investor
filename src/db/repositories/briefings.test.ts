import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import type { BriefingContent } from "@/insight/briefing-content";
import { createTestDb } from "../../../test/helpers/test-db";
import { briefings } from "../schema";
import {
  type Briefing,
  getBriefing,
  hasBriefing,
  latestBriefing,
  listBriefings,
  saveBriefing,
} from "./briefings";

function content(headline = "指數小漲"): BriefingContent {
  return {
    headline,
    summary: "加權指數收漲。",
    sections: [
      { title: "大盤", body: "今天加權指數小幅上漲。" },
      { title: "類股", body: "電子類股領漲。" },
    ],
    takeaway: "這是教育資訊，不是投資建議。",
    termIds: ["twii"],
  };
}

function briefing(overrides: Partial<Omit<Briefing, "createdAt">> = {}) {
  return {
    kind: "daily" as const,
    periodKey: "2026-10-08",
    lens: "beginner" as const,
    promptVersion: 1,
    model: "test-model",
    content: content(),
    ...overrides,
  };
}

describe("briefings repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("round-trips a saved briefing", async () => {
    const createdAt = new Date("2026-10-08T07:00:00Z");
    expect(await saveBriefing(db, { ...briefing(), createdAt })).toEqual({ saved: true });
    expect(await getBriefing(db, "daily", "2026-10-08", "beginner")).toEqual({
      ...briefing(),
      createdAt,
    });
  });

  it("returns null for a missing briefing and keeps lenses separate", async () => {
    await saveBriefing(db, briefing());
    expect(await getBriefing(db, "daily", "2026-10-08", "pro")).toBeNull();
    expect(await getBriefing(db, "daily", "2026-10-09", "beginner")).toBeNull();
  });

  it("ignores a save with the same prompt version and leaves content unchanged", async () => {
    await saveBriefing(db, briefing());
    expect(await saveBriefing(db, briefing({ content: content("改過的標題") }))).toEqual({
      saved: false,
    });
    expect((await getBriefing(db, "daily", "2026-10-08", "beginner"))?.content.headline).toBe(
      "指數小漲",
    );
  });

  it("ignores a save with a lower prompt version", async () => {
    await saveBriefing(db, briefing({ promptVersion: 3 }));
    expect(await saveBriefing(db, briefing({ promptVersion: 2, content: content("舊") }))).toEqual({
      saved: false,
    });
    expect((await getBriefing(db, "daily", "2026-10-08", "beginner"))?.promptVersion).toBe(3);
  });

  it("replaces the row when the prompt version is higher", async () => {
    await saveBriefing(db, briefing({ model: "old" }));
    const createdAt = new Date("2026-10-09T00:00:00Z");
    expect(
      await saveBriefing(db, {
        ...briefing({ promptVersion: 2, model: "new", content: content("新標題") }),
        createdAt,
      }),
    ).toEqual({ saved: true });
    const got = await getBriefing(db, "daily", "2026-10-08", "beginner");
    expect(got).toMatchObject({ promptVersion: 2, model: "new", createdAt });
    expect(got?.content.headline).toBe("新標題");
    expect(await db.select().from(briefings)).toHaveLength(1);
  });

  it("rejects content that does not match the schema before writing", async () => {
    await expect(
      saveBriefing(db, briefing({ content: { ...content(), headline: "" } })),
    ).rejects.toThrow();
    expect(await db.select().from(briefings)).toHaveLength(0);
  });

  it("rejects a period key that does not match the kind", async () => {
    await expect(saveBriefing(db, briefing({ kind: "weekly" }))).rejects.toThrow();
    await expect(saveBriefing(db, briefing({ periodKey: "2026-W41" }))).rejects.toThrow();
    await expect(saveBriefing(db, briefing({ periodKey: "20261008" }))).rejects.toThrow();
    expect(await db.select().from(briefings)).toHaveLength(0);
    expect(await saveBriefing(db, briefing({ kind: "weekly", periodKey: "2026-W41" }))).toEqual({
      saved: true,
    });
  });

  it("latestBriefing returns the greatest period key for the kind and lens", async () => {
    await saveBriefing(db, briefing({ periodKey: "2026-10-07" }));
    await saveBriefing(db, briefing({ periodKey: "2026-10-09" }));
    await saveBriefing(db, briefing({ periodKey: "2026-10-08" }));
    await saveBriefing(db, briefing({ periodKey: "2026-10-10", lens: "pro" }));
    await saveBriefing(db, briefing({ kind: "weekly", periodKey: "2026-W41" }));
    expect((await latestBriefing(db, "daily", "beginner"))?.periodKey).toBe("2026-10-09");
    expect((await latestBriefing(db, "daily", "pro"))?.periodKey).toBe("2026-10-10");
    expect((await latestBriefing(db, "weekly", "beginner"))?.periodKey).toBe("2026-W41");
    expect(await latestBriefing(db, "weekly", "pro")).toBeNull();
  });

  it("listBriefings is inclusive and ascending", async () => {
    for (const periodKey of ["2026-10-09", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10"])
      await saveBriefing(db, briefing({ periodKey }));
    await saveBriefing(db, briefing({ periodKey: "2026-10-08", lens: "pro" }));
    const list = await listBriefings(db, "daily", "2026-10-07", "2026-10-09", "beginner");
    expect(list.map((b) => b.periodKey)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });

  it("listBriefings orders weekly keys across a year boundary", async () => {
    for (const periodKey of ["2026-W02", "2025-W51", "2025-W52", "2026-W01", "2026-W03"])
      await saveBriefing(db, briefing({ kind: "weekly", periodKey }));
    const list = await listBriefings(db, "weekly", "2025-W52", "2026-W02", "beginner");
    expect(list.map((b) => b.periodKey)).toEqual(["2025-W52", "2026-W01", "2026-W02"]);
  });

  it("hasBriefing honours minPromptVersion", async () => {
    await saveBriefing(db, briefing({ promptVersion: 2 }));
    expect(await hasBriefing(db, "daily", "2026-10-08", "beginner", 1)).toBe(true);
    expect(await hasBriefing(db, "daily", "2026-10-08", "beginner", 2)).toBe(true);
    expect(await hasBriefing(db, "daily", "2026-10-08", "beginner", 3)).toBe(false);
    expect(await hasBriefing(db, "daily", "2026-10-08", "pro", 1)).toBe(false);
    expect(await hasBriefing(db, "daily", "2026-10-09", "beginner", 1)).toBe(false);
  });

  it("throws a descriptive error when stored content no longer matches the schema", async () => {
    await saveBriefing(db, briefing());
    await db.update(briefings).set({ content: { headline: "舊格式" } });
    await expect(getBriefing(db, "daily", "2026-10-08", "beginner")).rejects.toThrow(
      /daily.*2026-10-08.*beginner/,
    );
    await expect(latestBriefing(db, "daily", "beginner")).rejects.toThrow(/2026-10-08/);
    await expect(
      listBriefings(db, "daily", "2026-10-01", "2026-10-31", "beginner"),
    ).rejects.toThrow(/2026-10-08/);
  });
});
