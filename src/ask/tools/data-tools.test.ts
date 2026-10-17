import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { AskRequest } from "@/ask/schema";
import type { Db } from "@/db/client";
import { saveBriefing } from "@/db/repositories/briefings";
import { upsertEtfUniverse } from "@/db/repositories/etf-universe";
import { getCorporateActions, getPriceBars, upsertPriceBars } from "@/db/repositories/prices";
import { type NewSnapshot, saveSnapshot } from "@/db/repositories/snapshots";
import type { BriefingContent } from "@/insight/briefing-content";
import { buildTotalReturnIndex } from "@/planner/total-return";
import { parseDigest, parseSectorBoard, type SectorBoard } from "@/sources/darkfanxing";
import {
  LAST_BAR,
  PLAN_NOW,
  seedPlanMarket,
  weekdayBars,
} from "../../../test/helpers/plan-fixtures";
import { createTestDb } from "../../../test/helpers/test-db";
import { capResult, createDataTools, MAX_RESULT_BYTES } from "./data-tools";

const fixture = (name: string) => readFileSync(`test/fixtures/darkfanxing/${name}`, "utf8");
const DIGEST = parseDigest(fixture("digest-2026-10-08.html"));
const BOARD = parseSectorBoard(fixture("now-2026-10-08.html"));
const OPTIONS = { toolCallId: "t", messages: [], context: {} };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const PLAN: NonNullable<AskRequest["profile"]["plan"]> = {
  answers: {
    age: "age-40-49",
    horizon: "horizon-5-10y",
    income: "income-stable",
    reserve: "reserve-3-6m",
    loss: "loss-hold",
  },
  lump: 600_000,
  monthly: 10_000,
  monthlyExpenses: 30_000,
  existingReserve: 100_000,
};
const EMPTY_PROFILE: AskRequest["profile"] = { holdings: [], memory: [] };

const snapshot = (overrides: Partial<NewSnapshot>): NewSnapshot => ({
  kind: "sector_board",
  groupName: null,
  tradeDate: "2026-10-08",
  asOf: null,
  session: "closed",
  capturedAt: new Date("2026-10-08T07:00:00Z"),
  rawHtml: "<html></html>",
  parsed: BOARD,
  parseError: null,
  parserVersion: 1,
  ...overrides,
});

const briefingContent: BriefingContent = {
  headline: "大盤收漲",
  summary: "加權指數收漲。",
  sections: [
    { title: "大盤", body: "今天加權指數小幅上漲。" },
    { title: "類股", body: "電子類股領漲。" },
  ],
  takeaway: "這是教育資訊，不是投資建議。",
  termIds: ["force"],
};

describe("data tools", () => {
  let db: Db;
  let groundedSink: number[][];
  let profile: AskRequest["profile"];
  const tools = () => createDataTools({ db, now: PLAN_NOW, profile, groundedSink });
  async function call(name: string, input: unknown = {}): Promise<Record<string, unknown>> {
    const result = await tools()[name]?.execute?.(input as never, OPTIONS as never);
    return result as Record<string, unknown>;
  }

  beforeEach(async () => {
    db = await createTestDb();
    groundedSink = [];
    profile = EMPTY_PROFILE;
  });

  it("exposes exactly the six read-only tools, each described in Traditional Chinese", () => {
    const set = tools();
    expect(Object.keys(set).sort()).toEqual([
      "getInstrumentHistory",
      "getLatestBriefing",
      "getMarketToday",
      "getMyPlan",
      "getSectorBoard",
      "lookupTerm",
    ]);
    for (const tool of Object.values(set)) expect(tool.description).toMatch(/[一-鿿]/);
  });

  describe("getMarketToday", () => {
    it("summarises the digest and board with their data dates", async () => {
      await saveSnapshot(db, snapshot({ kind: "digest", parsed: DIGEST }));
      await saveSnapshot(db, snapshot({}));
      const result = await call("getMarketToday");
      expect(result.dataDate).toBe(DIGEST.tradeDate);
      expect(result.stale).toBe(false);
      expect(result.market).toMatchObject({ force: DIGEST.market.force });
      expect(result.board).toMatchObject({ dataDate: BOARD.tradeDate, asOf: BOARD.asOf });
      expect(result.truncated).toBeUndefined();
      expect(bytes(result)).toBeLessThanOrEqual(MAX_RESULT_BYTES);
    });

    it("reports no_data when nothing is stored", async () => {
      expect(await call("getMarketToday")).toEqual({ error: "no_data" });
    });
  });

  describe("getSectorBoard", () => {
    beforeEach(async () => {
      await saveSnapshot(db, snapshot({}));
    });

    it("lists the leaders by default, ten of them", async () => {
      const result = await call("getSectorBoard", {});
      const sectors = result.sectors as { name: string; changePct: number }[];
      expect(result.dataDate).toBe(BOARD.tradeDate);
      expect(sectors).toHaveLength(Math.min(10, BOARD.sectors.length));
      const top = Math.max(...BOARD.sectors.map((s) => s.changePct));
      expect(sectors[0]?.changePct).toBe(top);
      expect(sectors.map((s) => s.changePct)).toEqual(
        [...sectors.map((s) => s.changePct)].sort((a, b) => b - a),
      );
      expect(result.totalSectors).toBe(BOARD.sectors.length);
    });

    it("lists the laggards, ascending, within the limit", async () => {
      const result = await call("getSectorBoard", { limit: 3, order: "laggards" });
      const sectors = result.sectors as { changePct: number }[];
      expect(sectors).toHaveLength(3);
      expect(sectors[0]?.changePct).toBe(Math.min(...BOARD.sectors.map((s) => s.changePct)));
    });

    it("validates its input", () => {
      const schema = tools().getSectorBoard?.inputSchema as {
        safeParse: (v: unknown) => { success: boolean };
      };
      expect(schema.safeParse({ limit: 0 }).success).toBe(false);
      expect(schema.safeParse({ limit: 31 }).success).toBe(false);
      expect(schema.safeParse({ order: "sideways" }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(true);
    });

    it("keeps the result under the cap by dropping sectors and says so", async () => {
      const long = "很長的類股名稱".repeat(10);
      const board: SectorBoard = {
        ...BOARD,
        sectors: Array.from({ length: 30 }, (_, i) => ({
          ...(BOARD.sectors[0] as SectorBoard["sectors"][number]),
          name: `${long}${i}`,
          changePct: 30 - i,
        })),
      };
      await saveSnapshot(db, snapshot({ tradeDate: "2026-10-09", parsed: board }));
      const result = await call("getSectorBoard", { limit: 30 });
      expect(bytes(result)).toBeLessThanOrEqual(MAX_RESULT_BYTES);
      expect(result.truncated).toBe(true);
      const sectors = result.sectors as { changePct: number }[];
      expect(sectors.length).toBeLessThan(30);
      expect(sectors[0]?.changePct).toBe(30);
    });

    it("reports no_data without a board", async () => {
      db = await createTestDb();
      expect(await call("getSectorBoard", {})).toEqual({ error: "no_data" });
    });
  });

  describe("lookupTerm", () => {
    it("finds a term by id and returns related ids", async () => {
      const result = await call("lookupTerm", { query: "force" });
      const matches = result.matches as { id: string; related: string[]; beginner: unknown }[];
      expect(matches[0]?.id).toBe("force");
      expect(Array.isArray(matches[0]?.related)).toBe(true);
      expect(matches[0]?.beginner).toBeTruthy();
    });

    it("finds a term by its name and by an alias", async () => {
      const first = (await call("lookupTerm", { query: "force" })).matches as { term: string }[];
      const byName = await call("lookupTerm", { query: first[0]?.term });
      expect((byName.matches as { id: string }[])[0]?.id).toBe("force");
    });

    it("reports term_not_found for nonsense", async () => {
      expect(await call("lookupTerm", { query: "zzzz-no-such-term" })).toEqual({
        error: "term_not_found",
      });
    });
  });

  describe("getInstrumentHistory", () => {
    beforeEach(async () => {
      await seedPlanMarket(db);
    });

    it("returns coverage, last close, returns and drawdown from the stored prices", async () => {
      const result = await call("getInstrumentHistory", { symbol: "0050" });
      expect(result).toMatchObject({ symbol: "0050", name: "元大台灣50", dataDate: LAST_BAR });
      expect(result.firstDate).toBe("2020-01-02");
      const bars = await getPriceBars(db, "0050", "1900-01-01", LAST_BAR);
      expect(result.lastClose).toBe(bars.at(-1)?.close);
      const index = buildTotalReturnIndex(bars, await getCorporateActions(db, "0050"));
      const last = index.at(-1)?.index as number;
      // 2026-09-14 is the first date on or before one month before LAST_BAR (2026-09-14).
      const start = index.findLast((p) => p.date <= "2026-09-14")?.index as number;
      expect(result.return1mPct).toBeCloseTo((last / start - 1) * 100, 1);
      for (const key of ["return3mPct", "return1yPct", "return3yPct"]) {
        expect(typeof result[key]).toBe("number");
      }
      expect(result.maxDrawdownPct).toBeLessThanOrEqual(0);
    });

    it("leaves a return null when the history is shorter than its period", async () => {
      const result = await call("getInstrumentHistory", { symbol: "00679B" });
      // 00679B starts 2023-01-03: more than 3 years before LAST_BAR (2026-10-14), so all exist.
      expect(typeof result.return3yPct).toBe("number");
      await upsertEtfUniverse(db, [
        { symbol: "00999", name: "新ETF", industry: "ETF", market: "twse" },
      ]);
      await upsertPriceBars(db, weekdayBars("00999", "2026-10-01", LAST_BAR, 20, 0.001));
      const young = await call("getInstrumentHistory", { symbol: "00999" });
      expect(young).toMatchObject({ symbol: "00999", return1mPct: null, return3yPct: null });
      expect(young.maxDrawdownPct).toBeLessThanOrEqual(0);
    });

    it("answers unknown_symbol for a symbol outside the tracked universe", async () => {
      expect(await call("getInstrumentHistory", { symbol: "2330" })).toEqual({
        error: "unknown_symbol",
      });
    });

    it("answers no_price_data for a tracked symbol without bars", async () => {
      await upsertEtfUniverse(db, [
        { symbol: "00998", name: "空ETF", industry: "ETF", market: "twse" },
      ]);
      expect(await call("getInstrumentHistory", { symbol: "00998" })).toEqual({
        error: "no_price_data",
      });
    });
  });

  describe("getMyPlan", () => {
    it("answers no_plan without a plan in the profile", async () => {
      expect(await call("getMyPlan")).toEqual({ error: "no_plan" });
    });

    it("runs the planner for the profile's plan and omits the value series", async () => {
      profile = { ...EMPTY_PROFILE, plan: PLAN };
      await seedPlanMarket(db);
      const result = await call("getMyPlan");
      expect(result.kind).toBe("plan");
      expect(result.level).toBe(3);
      expect(result.window).toMatchObject({ from: "2023-01-03", to: LAST_BAR });
      expect(result.allocation).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: "core", symbol: "0050", weightPct: 45 }),
        ]),
      );
      expect(result.reserve).toMatchObject({ target: expect.any(Number) });
      expect(JSON.stringify(result)).not.toContain("valueSeries");
      const metrics = result.metrics as Record<string, Record<string, unknown>>;
      expect(Object.keys(metrics).sort()).toEqual(["dca", "lump", "plan"]);
      expect(metrics.lump).toHaveProperty("maxDrawdownPct");
      expect(bytes(result)).toBeLessThanOrEqual(MAX_RESULT_BYTES);
    });

    it("explains data_unavailable when no instrument has prices", async () => {
      profile = { ...EMPTY_PROFILE, plan: PLAN };
      expect(await call("getMyPlan")).toEqual({ error: "data_unavailable" });
    });

    it("returns the reserve-only outcome without market data", async () => {
      profile = { ...EMPTY_PROFILE, plan: { ...PLAN, lump: 50_000, existingReserve: 0 } };
      const result = await call("getMyPlan");
      expect(result.kind).toBe("reserve_only");
      expect(result.reserve).toBeTruthy();
    });
  });

  describe("getLatestBriefing", () => {
    it("returns the latest briefing for the lens and kind", async () => {
      await saveBriefing(db, {
        kind: "daily",
        periodKey: "2026-10-08",
        lens: "beginner",
        promptVersion: 1,
        model: "m",
        content: briefingContent,
      });
      const result = await call("getLatestBriefing", { lens: "beginner", kind: "daily" });
      expect(result).toMatchObject({
        kind: "daily",
        lens: "beginner",
        periodKey: "2026-10-08",
        dataDate: "2026-10-08",
        headline: "大盤收漲",
      });
      expect((result.sections as unknown[]).length).toBe(2);
    });

    it("reports no_briefing when none is stored", async () => {
      expect(await call("getLatestBriefing", { lens: "pro", kind: "weekly" })).toEqual({
        error: "no_briefing",
      });
    });
  });

  describe("grounding", () => {
    it("pushes one group of the result's numbers per call", async () => {
      await saveSnapshot(db, snapshot({}));
      await call("getSectorBoard", { limit: 2 });
      await call("getSectorBoard", { limit: 1, order: "laggards" });
      expect(groundedSink).toHaveLength(2);
      const top = BOARD.sectors.reduce((a, b) => (b.changePct > a.changePct ? b : a));
      expect(groundedSink[0]).toContain(top.changePct);
      expect(groundedSink[1]).not.toBe(groundedSink[0]);
    });

    it("pushes a group even for an error result", async () => {
      await call("lookupTerm", { query: "zzzz-no-such-term" });
      expect(groundedSink).toHaveLength(1);
    });
  });
});

describe("capResult", () => {
  it("returns a small result untouched", () => {
    const value = { list: [1, 2, 3] };
    expect(capResult(value)).toBe(value);
  });

  it("drops items from the largest list until it fits, then flags truncation", () => {
    const value = {
      dataDate: "2026-10-08",
      list: Array.from({ length: 400 }, (_, i) => `項目${i}`.repeat(5)),
    };
    const capped = capResult(value) as { list: string[]; truncated?: boolean; dataDate: string };
    expect(bytes(capped)).toBeLessThanOrEqual(MAX_RESULT_BYTES);
    expect(capped.truncated).toBe(true);
    expect(capped.list.length).toBeLessThan(400);
    expect(capped.list[0]).toBe(value.list[0]);
    expect(capped.dataDate).toBe("2026-10-08");
    expect(value.list).toHaveLength(400);
  });

  it("finds lists nested one level down", () => {
    const value = {
      board: { rows: Array.from({ length: 600 }, (_, i) => `row-${i}-${"x".repeat(30)}`) },
    };
    const capped = capResult(value) as { board: { rows: string[] }; truncated?: boolean };
    expect(bytes(capped)).toBeLessThanOrEqual(MAX_RESULT_BYTES);
    expect(capped.truncated).toBe(true);
  });

  it("gives up with an error when there is nothing left to drop", () => {
    expect(capResult({ text: "字".repeat(5000) })).toEqual({
      error: "result_too_large",
      truncated: true,
    });
  });
});
