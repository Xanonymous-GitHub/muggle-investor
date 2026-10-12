import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { saveBriefing } from "@/db/repositories/briefings";
import { type NewSnapshot, saveSnapshot } from "@/db/repositories/snapshots";
import { shiftDate } from "@/ingestion/shift-date";
import type { BriefingContent } from "@/insight/briefing-content";
import type { Lens } from "@/insight/lens";
import { type DigestSnapshot, parseDigest } from "@/sources/darkfanxing";
import { createTestDb } from "../../test/helpers/test-db";
import { getRecap, RECAP_MAX_DAYS } from "./recap-service";

const warn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: { warn: (...args: unknown[]) => warn(...args), error: vi.fn(), info: vi.fn() },
}));

const FIXTURE = parseDigest(
  readFileSync("test/fixtures/darkfanxing/digest-2026-10-08.html", "utf8"),
);
const NOW = new Date("2026-10-12T03:00:00Z");

type Futures = { close: number; change: number; changePct: number };

/** The fixture digest re-dated, with its futures overridden (null removes them). */
function digestOn(tradeDate: string, futures: Futures | null = null): DigestSnapshot {
  return {
    ...FIXTURE,
    tradeDate,
    market: {
      ...FIXTURE.market,
      futures: futures && {
        open: futures.close,
        high: futures.close,
        low: futures.close,
        ...futures,
      },
    },
  };
}

const rowOf = (tradeDate: string, overrides: Partial<NewSnapshot> = {}): NewSnapshot => ({
  kind: "digest",
  groupName: null,
  tradeDate,
  asOf: null,
  session: "closed",
  capturedAt: new Date(`${tradeDate}T07:00:00Z`),
  rawHtml: "<html></html>",
  parsed: digestOn(tradeDate),
  parseError: null,
  parserVersion: 1,
  ...overrides,
});

const content = (summary: string): BriefingContent => ({
  headline: "標題",
  summary,
  sections: [
    { title: "一", body: "內容一" },
    { title: "二", body: "內容二" },
  ],
  takeaway: "重點",
  termIds: [],
});

const briefing = (
  kind: "daily" | "weekly",
  periodKey: string,
  lens: Lens,
  summary = `${periodKey} ${lens}`,
) =>
  ({
    kind,
    periodKey,
    lens,
    promptVersion: 1,
    model: "fake",
    content: content(summary),
  }) as const;

describe("getRecap", () => {
  let db: Db;
  const recap = (since: string) => getRecap(db, { since, now: NOW });
  const store = async (tradeDate: string, futures: Futures | null = null) => {
    await saveSnapshot(db, rowOf(tradeDate, { parsed: digestOn(tradeDate, futures) }));
  };

  beforeEach(async () => {
    warn.mockClear();
    db = await createTestDb();
  });

  it("returns every day after since with the cumulative futures move and the quadrant shift", async () => {
    await store("2026-10-06", { close: 20000, change: 100, changePct: 0.5 });
    await store("2026-10-07", { close: 20100, change: 100, changePct: 0.5 });
    await store("2026-10-08", { close: 20300, change: 200, changePct: 1 });

    const result = await recap("2026-10-05");

    expect(result.kind).toBe("recap");
    if (result.kind !== "recap") return;
    expect(result.days.map((d) => d.tradeDate)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(result.missedTradingDays).toBe(3);
    expect(result.from).toBe("2026-10-06");
    expect(result.to).toBe("2026-10-08");
    expect(result.truncated).toBe(false);
    // base = 20000 - 100; (20300 - 19900) / 19900 * 100 = 2.0100...
    expect(result.cumulative.futuresChangePct).toBe(2.01);
    expect(result.days[0]).toMatchObject({
      futuresClose: 20000,
      futuresChangePct: 0.5,
      force: FIXTURE.market.force,
      breadth: FIXTURE.market.breadth,
      upGroups: FIXTURE.market.upGroups,
      downGroups: FIXTURE.market.downGroups,
      coveredByWeek: null,
    });
    expect(FIXTURE.quadrant).not.toBeNull();
    expect(result.quadrantShift).toEqual({
      from: FIXTURE.quadrant?.counts.today,
      to: FIXTURE.quadrant?.counts.today,
    });
  });

  it("is up-to-date when since is the latest data date or later, or nothing is stored", async () => {
    expect(await recap("2026-10-05")).toEqual({ kind: "up-to-date", latestTradeDate: null });
    await store("2026-10-08");
    expect(await recap("2026-10-08")).toEqual({
      kind: "up-to-date",
      latestTradeDate: "2026-10-08",
    });
    expect(await recap("2026-10-11")).toEqual({
      kind: "up-to-date",
      latestTradeDate: "2026-10-08",
    });
  });

  it("returns everything stored when since predates the data, without truncating", async () => {
    await store("2026-10-06");
    await store("2026-10-08");
    const result = await recap("2026-08-01");
    expect(result).toMatchObject({ kind: "recap", truncated: false, missedTradingDays: 2 });
  });

  it("caps the span at 90 days and flags it", async () => {
    const latest = "2026-10-08";
    for (let back = 0; back <= 120; back++) await store(shiftDate(latest, -back));
    const result = await recap(shiftDate(latest, -120));
    expect(result.kind).toBe("recap");
    if (result.kind !== "recap") return;
    expect(result.truncated).toBe(true);
    expect(result.days).toHaveLength(RECAP_MAX_DAYS);
    expect(result.days[0]?.tradeDate).toBe(shiftDate(latest, -(RECAP_MAX_DAYS - 1)));
    expect(result.days.at(-1)?.tradeDate).toBe(latest);
  });

  it("does not truncate a span of exactly 90 days", async () => {
    await store("2026-07-10");
    await store("2026-10-08");
    const result = await recap("2026-07-10");
    expect(result).toMatchObject({ kind: "recap", truncated: false, missedTradingDays: 1 });
  });

  it("counts only days with data across a holiday and weekend gap", async () => {
    await store("2026-10-07");
    await store("2026-10-08"); // 10-09 holiday, then the weekend: nothing newer yet
    const result = await recap("2026-10-07");
    expect(result).toMatchObject({ kind: "recap", missedTradingDays: 1 });
    if (result.kind === "recap")
      expect(result.days.map((d) => d.tradeDate)).toEqual(["2026-10-08"]);
  });

  it("ignores a later unparsed capture in favour of the earlier parsed one", async () => {
    await store("2026-10-08", { close: 20300, change: 200, changePct: 1 });
    await saveSnapshot(
      db,
      rowOf("2026-10-08", { capturedAt: new Date("2026-10-08T09:00:00Z"), parsed: null }),
    );
    const result = await recap("2026-10-07");
    expect(result.kind).toBe("recap");
    if (result.kind !== "recap") return;
    expect(result.days).toHaveLength(1);
    expect(result.days[0]?.futuresClose).toBe(20300);
  });

  it("skips a row that no longer matches the digest schema and warns once", async () => {
    await store("2026-10-06");
    await saveSnapshot(db, rowOf("2026-10-07", { parsed: { ok: true } }));
    await saveSnapshot(
      db,
      rowOf("2026-10-07", { session: "closed", asOf: "x", parsed: { ok: 1 } }),
    );
    await store("2026-10-08");
    const result = await recap("2026-10-05");
    expect(result.kind).toBe("recap");
    if (result.kind !== "recap") return;
    expect(result.days.map((d) => d.tradeDate)).toEqual(["2026-10-06", "2026-10-08"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("leaves futures and the cumulative null when futures are missing", async () => {
    await store("2026-10-07", { close: 20000, change: 100, changePct: 0.5 });
    await store("2026-10-08");
    const result = await recap("2026-10-06");
    expect(result.kind).toBe("recap");
    if (result.kind !== "recap") return;
    expect(result.days[1]).toMatchObject({ futuresClose: null, futuresChangePct: null });
    expect(result.cumulative.futuresChangePct).toBeNull();
  });

  it("leaves the quadrant shift null when an end day has no quadrant", async () => {
    await saveSnapshot(
      db,
      rowOf("2026-10-07", { parsed: { ...digestOn("2026-10-07"), quadrant: null } }),
    );
    await store("2026-10-08");
    const result = await recap("2026-10-06");
    expect(result.kind === "recap" && result.quadrantShift).toBeNull();
  });

  it("uses each day's daily briefing summary per lens, null where none exists", async () => {
    await store("2026-10-07");
    await store("2026-10-08");
    await saveBriefing(db, briefing("daily", "2026-10-08", "beginner", "新手摘要"));
    await saveBriefing(db, briefing("daily", "2026-10-08", "pro", "專業摘要"));
    await saveBriefing(db, briefing("daily", "2026-10-07", "pro", "只有專業"));
    const result = await recap("2026-10-06");
    expect(result.kind).toBe("recap");
    if (result.kind !== "recap") return;
    expect(result.days[0]?.summary).toEqual({ beginner: null, pro: "只有專業" });
    expect(result.days[1]?.summary).toEqual({ beginner: "新手摘要", pro: "專業摘要" });
  });

  describe("week coverage", () => {
    const storeWeek41 = async () => {
      for (const date of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"])
        await store(date);
    };

    it("covers a week fully inside the range that has a weekly briefing", async () => {
      await storeWeek41();
      await saveBriefing(db, briefing("weekly", "2026-W41", "beginner"));
      const result = await recap("2026-10-04");
      expect(result.kind).toBe("recap");
      if (result.kind !== "recap") return;
      expect(result.weeks).toHaveLength(1);
      expect(result.weeks[0]).toMatchObject({
        weekKey: "2026-W41",
        from: "2026-10-05",
        to: "2026-10-11",
      });
      expect(result.weeks[0]?.briefings.beginner?.summary).toBe("2026-W41 beginner");
      expect(result.weeks[0]?.briefings.pro).toBeNull();
      expect(result.days.every((d) => d.coveredByWeek === "2026-W41")).toBe(true);
    });

    it("does not cover a week without a weekly briefing", async () => {
      await storeWeek41();
      const result = await recap("2026-10-04");
      expect(result.kind).toBe("recap");
      if (result.kind !== "recap") return;
      expect(result.weeks).toEqual([]);
      expect(result.days.every((d) => d.coveredByWeek === null)).toBe(true);
    });

    it("does not cover a week that started before since, even with a briefing", async () => {
      await storeWeek41();
      await saveBriefing(db, briefing("weekly", "2026-W41", "pro"));
      const result = await recap("2026-10-05");
      expect(result.kind).toBe("recap");
      if (result.kind !== "recap") return;
      expect(result.weeks).toEqual([]);
      expect(result.days.every((d) => d.coveredByWeek === null)).toBe(true);
    });

    it("covers only the complete weeks of a longer range", async () => {
      await store("2026-09-30"); // W40, since falls inside it
      await store("2026-10-01"); // W40
      await storeWeek41();
      await saveBriefing(db, briefing("weekly", "2026-W40", "pro"));
      await saveBriefing(db, briefing("weekly", "2026-W41", "pro"));
      const result = await recap("2026-09-30");
      expect(result.kind).toBe("recap");
      if (result.kind !== "recap") return;
      expect(result.weeks.map((w) => w.weekKey)).toEqual(["2026-W41"]);
      expect(result.days.map((d) => d.coveredByWeek)).toEqual([
        null,
        "2026-W41",
        "2026-W41",
        "2026-W41",
        "2026-W41",
      ]);
    });
  });
});
