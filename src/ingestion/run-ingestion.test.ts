import { readFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { getBriefing } from "@/db/repositories/briefings";
import { getHolidays, replaceHolidays } from "@/db/repositories/calendar";
import { listEtfUniverse, upsertEtfUniverse } from "@/db/repositories/etf-universe";
import { getPriceBars, latestPriceDate, upsertPriceBars } from "@/db/repositories/prices";
import { saveSnapshot } from "@/db/repositories/snapshots";
import { briefings, marketSnapshots, planExplanations } from "@/db/schema";
import type { BriefingContent } from "@/insight/briefing-content";
import type { Lens } from "@/insight/lens";
import type { GenerateObjectRequest, Llm } from "@/insight/llm";
import { CATEGORY_MEMBERS } from "@/planner/rules/instruments";
import { createDarkfanxingClient, parseDigest } from "@/sources/darkfanxing";
import type { FinMindClient, PriceBar } from "@/sources/finmind";
import { createTwseClient, type MarketHoliday, type TwseClient } from "@/sources/twse";
import { seedPlanMarket } from "../../test/helpers/plan-fixtures";
import { createTestDb } from "../../test/helpers/test-db";
import { BRIEFING_RUN_BUDGET_MS } from "./briefings";
import { reparseSnapshots } from "./reparse";
import { type IngestionReport, PRICE_RUN_BUDGET_MS, runIngestion } from "./run-ingestion";
import { PARSER_VERSION } from "./snapshot-row";
import { TRACKED_SYMBOLS } from "./tracked-symbols";

type CalendarRepo = typeof import("@/db/repositories/calendar");
type PricesRepo = typeof import("@/db/repositories/prices");

// Pass-through spies so individual tests can make one repository read throw.
vi.mock("@/db/repositories/calendar", async (importOriginal) => {
  const actual = await importOriginal<CalendarRepo>();
  return { ...actual, getHolidays: vi.fn(actual.getHolidays) };
});
vi.mock("@/db/repositories/prices", async (importOriginal) => {
  const actual = await importOriginal<PricesRepo>();
  return { ...actual, latestPriceDate: vi.fn(actual.latestPriceDate) };
});
vi.mock("./reparse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reparse")>();
  return { ...actual, reparseSnapshots: vi.fn(actual.reparseSnapshots) };
});
const actualReparse = await vi.importActual<typeof import("./reparse")>("./reparse");
const actualCalendar = await vi.importActual<CalendarRepo>("@/db/repositories/calendar");
const actualPrices = await vi.importActual<PricesRepo>("@/db/repositories/prices");

/** Contains characters that URL-encode differently, so both stored forms can be checked. */
const KEY = "test+key/0123456789abcdef";
const fixture = (path: string) => readFileSync(`test/fixtures/${path}`, "utf8");
const DIGEST = fixture("darkfanxing/digest-2026-10-08.html");
const BOARD = fixture("darkfanxing/now-2026-10-08.html");

/** Taipei wall-clock instants (UTC+8). */
const THU_POST_CLOSE = new Date("2026-10-08T07:00:00Z"); // 2026-10-08 15:00
const THU_INTRADAY = new Date("2026-10-08T02:30:00Z"); // 2026-10-08 10:30
const SUN_MORNING = new Date("2026-10-11T02:00:00Z"); // 2026-10-11 10:00, Sunday
const MON_POST_CLOSE = new Date("2026-10-12T07:00:00Z"); // 2026-10-12 15:00

const silent = pino({ level: "silent" });
const noLimit = { acquire: async () => {}, tryAcquire: () => true };

const bar = (symbol: string, date: string): PriceBar => ({
  symbol,
  date,
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 1_000,
  turnover: null,
});

type Upstream = { digest: () => Response; board: () => Response };

const html = (body: string) => () =>
  new Response(body, { status: 200, headers: { "content-type": "text/html" } });

function fakeDarkfanxing(upstream: Upstream) {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const kind = url.includes("/api/digest/") ? "digest" : "board";
    requests.push(kind);
    return upstream[kind]();
  }) as typeof fetch;
  const client = createDarkfanxingClient({
    baseUrl: "https://upstream.test",
    key: KEY,
    limiter: noLimit,
    fetchImpl,
    sleep: async () => {},
  });
  return { client, requests };
}

function fakeFinMind(overrides: Partial<FinMindClient> = {}) {
  return {
    fetchStockInfo: vi.fn<FinMindClient["fetchStockInfo"]>(
      overrides.fetchStockInfo ?? (async () => []),
    ),
    fetchPrices: vi.fn<FinMindClient["fetchPrices"]>(
      overrides.fetchPrices ?? (async (symbol) => [bar(symbol, "2026-10-08")]),
    ),
    fetchCorporateActions: vi.fn<FinMindClient["fetchCorporateActions"]>(
      overrides.fetchCorporateActions ?? (async () => []),
    ),
  };
}

function fixtureTwse(): TwseClient {
  const body = fixture("twse/holiday-schedule.json");
  return createTwseClient({
    limiter: noLimit,
    fetchImpl: (async () =>
      new Response(body, { headers: { "content-type": "application/json" } })) as typeof fetch,
  });
}

/** Numbers here all appear in the 2026-10-08 fixture's daily and (single-day) weekly fact sheets. */
const CONTENT: BriefingContent = {
  headline: "台指期收 49349 點",
  summary: "",
  sections: [
    { title: "大盤節奏", body: "多數族群小漲，但跌的族群跌得比較深。" },
    { title: "這對你意味著什麼", body: "像班上一半同學考好、一半考差，平均分數看不出全貌。" },
  ],
  takeaway: "本內容僅供學習參考，不構成投資建議。",
  termIds: [],
};

/** Lens-specific so a test can tell whose summary reached a prompt. */
const SUMMARY = {
  beginner: "上漲族群 87、下跌族群 88，漲跌幾乎各半。",
  pro: "上漲族群 87、下跌族群 88，廣度大致持平。",
} as const;

const lensOf = (req: GenerateObjectRequest<unknown>): Lens =>
  req.system.includes("【讀者：專業投資人】") ? "pro" : "beginner";

const contentFor = (req: GenerateObjectRequest<unknown>): BriefingContent => ({
  ...CONTENT,
  summary: SUMMARY[lensOf(req)],
});

const UNGROUNDED = (req: GenerateObjectRequest<unknown>): BriefingContent => ({
  ...contentFor(req),
  summary: "成交量放大到 7.77 兆。",
});

type LlmBehavior = (call: number, req: GenerateObjectRequest<unknown>) => BriefingContent;

/** A fake LLM answering every call with lens-specific content unless `behavior` says otherwise (it may throw). */
function fakeLlm(behavior: LlmBehavior = (_call, req) => contentFor(req)) {
  const requests: GenerateObjectRequest<unknown>[] = [];
  const llm: Llm = {
    modelId: "fake-model",
    async generateObject<T>(req: GenerateObjectRequest<T>) {
      requests.push(req);
      const object = behavior(requests.length, req);
      return { object: req.schema.parse(object), usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  return { llm, requests };
}

const statusOf = (report: IngestionReport, name: string) =>
  report.actions.find((action) => action.name === name);

describe("runIngestion", () => {
  let db: Db;
  let darkfanxing: ReturnType<typeof fakeDarkfanxing>;
  let finmind: ReturnType<typeof fakeFinMind>;
  let twse: TwseClient;
  let llm: ReturnType<typeof fakeLlm>;

  const run = (now: Date, overrides: Partial<Parameters<typeof runIngestion>[0]> = {}) =>
    runIngestion({
      db,
      darkfanxing: darkfanxing.client,
      darkfanxingKey: KEY,
      finmind,
      twse,
      llm: llm.llm,
      now,
      logger: silent,
      ...overrides,
    });

  /** A closed, parsed digest for `date`, shaped like the 2026-10-08 fixture. */
  const storeDigest = (date: string) =>
    saveSnapshot(db, {
      kind: "digest",
      groupName: null,
      tradeDate: date,
      asOf: null,
      session: "closed",
      capturedAt: new Date(`${date}T07:00:00Z`),
      rawHtml: "<html></html>",
      parsed: { ...parseDigest(DIGEST), tradeDate: date },
      parseError: null,
      parserVersion: PARSER_VERSION,
    });

  const briefingNames = (report: IngestionReport) =>
    report.actions.map((a) => a.name).filter((name) => name.startsWith("briefing:"));

  const snapshots = () =>
    db
      .select()
      .from(marketSnapshots)
      .orderBy(asc(marketSnapshots.kind), asc(marketSnapshots.tradeDate));

  beforeEach(async () => {
    vi.mocked(getHolidays).mockImplementation(actualCalendar.getHolidays);
    vi.mocked(latestPriceDate).mockImplementation(actualPrices.latestPriceDate);
    vi.mocked(reparseSnapshots).mockImplementation(actualReparse.reparseSnapshots);
    db = await createTestDb();
    darkfanxing = fakeDarkfanxing({ digest: html(DIGEST), board: html(BOARD) });
    finmind = fakeFinMind();
    twse = fixtureTwse();
    llm = fakeLlm();
  });

  /** Runs until no symbol's backfill is deferred any more (each run backfills at most 3). */
  const backfillAll = async (now: Date) => {
    for (let i = 0; i < 10; i++) {
      const report = await run(now);
      if (!report.actions.some((a) => a.detail === "backfill deferred")) return report;
    }
    throw new Error("backfill did not finish");
  };

  it("post-close run saves one closed digest, one board and backfills prices", async () => {
    const report = await run(THU_POST_CLOSE);

    expect(report.phase).toBe("post-close");
    expect(statusOf(report, "holidays")?.status).toBe("done");
    expect(statusOf(report, "digest")?.status).toBe("done");
    expect(statusOf(report, "sector_board")?.status).toBe("done");
    const rows = await snapshots();
    expect(rows.map((r) => [r.kind, r.tradeDate, r.session, r.asOf])).toEqual([
      ["digest", "2026-10-08", "closed", null],
      ["sector_board", "2026-10-08", "closed", "13:34"],
    ]);
    expect(rows.every((r) => r.parsed !== null && r.parseError === null)).toBe(true);
    expect(darkfanxing.requests).toEqual(["digest", "board"]);

    for (const symbol of TRACKED_SYMBOLS.slice(0, 3)) {
      expect(statusOf(report, `prices:${symbol}`)?.status).toBe("done");
      expect(statusOf(report, `corporate_actions:${symbol}`)?.status).toBe("done");
      expect(finmind.fetchPrices).toHaveBeenCalledWith(symbol, "2003-01-01", "2026-10-08");
      expect(finmind.fetchCorporateActions).toHaveBeenCalledWith(symbol, "2003-01-01");
      expect(await getPriceBars(db, symbol, "2026-10-08", "2026-10-08")).toHaveLength(1);
    }
    expect((await getHolidays(db, 2026)).length).toBeGreaterThan(0);
  });

  it("a second identical run skips everything and inserts no duplicates", async () => {
    await backfillAll(THU_POST_CLOSE);
    darkfanxing.requests.length = 0;
    finmind.fetchPrices.mockClear();

    const report = await run(THU_POST_CLOSE);

    expect(statusOf(report, "holidays")?.status).toBe("skipped");
    expect(statusOf(report, "digest")?.status).toBe("skipped");
    expect(statusOf(report, "sector_board")?.status).toBe("skipped");
    expect(statusOf(report, "prices:0050")?.status).toBe("skipped");
    expect(await snapshots()).toHaveLength(2);
    expect(darkfanxing.requests).toEqual([]);
    expect(finmind.fetchPrices).not.toHaveBeenCalled();
  });

  it("on a Sunday with the last session already stored, inserts nothing (Review Focus #4)", async () => {
    await run(THU_POST_CLOSE);
    darkfanxing.requests.length = 0;
    const before = await snapshots();

    const report = await run(SUN_MORNING);

    expect(report.phase).toBe("closed-day");
    expect(statusOf(report, "digest")).toMatchObject({ status: "skipped" });
    expect(await snapshots()).toEqual(before);
    expect(darkfanxing.requests).toEqual([]);
  });

  it("on a Sunday with the last session missing, catches up using the content date", async () => {
    const report = await run(SUN_MORNING);

    expect(report.phase).toBe("closed-day");
    expect(statusOf(report, "digest")?.status).toBe("done");
    const rows = await snapshots();
    expect(rows.map((r) => [r.kind, r.tradeDate])).toEqual([
      ["digest", "2026-10-08"],
      ["sector_board", "2026-10-08"],
    ]);
  });

  it("reports 'upstream not yet updated' when upstream still serves an older session", async () => {
    await run(THU_POST_CLOSE);
    darkfanxing.requests.length = 0;
    finmind.fetchPrices.mockClear();

    const report = await run(MON_POST_CLOSE);

    expect(report.phase).toBe("post-close");
    expect(statusOf(report, "digest")).toMatchObject({ status: "skipped" });
    expect(statusOf(report, "digest")?.detail).toMatch(/^upstream not yet updated/);
    expect(statusOf(report, "sector_board")?.detail).toMatch(/^upstream not yet updated/);
    expect(darkfanxing.requests).toEqual(["digest", "board"]);
    expect(await snapshots()).toHaveLength(2);
    // Prices resume the day after the latest stored bar (10-09 holiday and weekend included).
    expect(finmind.fetchPrices).toHaveBeenCalledWith("0050", "2026-10-09", "2026-10-12");
  });

  it("intraday run saves only the sector board and touches neither digest nor prices", async () => {
    const intradayBoard = BOARD.replaceAll("13:34（收盤後）", "10:30（盤中）");
    darkfanxing = fakeDarkfanxing({ digest: html(DIGEST), board: html(intradayBoard) });

    const report = await run(THU_INTRADAY);

    expect(report.phase).toBe("intraday");
    expect(report.actions.map((a) => a.name)).toEqual(["holidays", "sector_board"]);
    expect(statusOf(report, "sector_board")?.status).toBe("done");
    const rows = await snapshots();
    expect(rows.map((r) => [r.kind, r.session, r.asOf])).toEqual([
      ["sector_board", "intraday", "10:30"],
    ]);
    expect(darkfanxing.requests).toEqual(["board"]);
    expect(finmind.fetchPrices).not.toHaveBeenCalled();
  });

  it("a FinMind failure fails only that action; the digest is still saved", async () => {
    finmind = fakeFinMind({
      fetchPrices: vi.fn(async () => {
        throw new Error("FinMind TaiwanStockPrice failed with status 402: quota");
      }),
    });

    const report = await run(THU_POST_CLOSE);

    expect(statusOf(report, "prices:0050")).toMatchObject({
      status: "failed",
      detail: expect.stringContaining("402"),
    });
    expect(statusOf(report, "prices:006208")?.status).toBe("failed");
    expect(statusOf(report, "corporate_actions:0050")?.status).toBe("done");
    expect(statusOf(report, "digest")?.status).toBe("done");
    expect((await snapshots()).filter((r) => r.kind === "digest")).toHaveLength(1);
  });

  it("an upstream HTTP failure fails that action without leaking the key into the report", async () => {
    darkfanxing = fakeDarkfanxing({
      digest: () => new Response("boom", { status: 500 }),
      board: html(BOARD),
    });

    const report = await run(THU_POST_CLOSE);

    expect(statusOf(report, "digest")?.status).toBe("failed");
    expect(statusOf(report, "sector_board")?.status).toBe("done");
    const json = JSON.stringify(report);
    expect(json).not.toContain(KEY);
    expect(json).not.toContain(encodeURIComponent(KEY));
  });

  it("saves raw HTML when parsing fails, dated by the title", async () => {
    const broken = DIGEST.replace(/<table[\s\S]*?<\/table>/g, "<table></table>").replace(
      /<h2[\s\S]*$/,
      "",
    );
    darkfanxing = fakeDarkfanxing({ digest: html(broken), board: html(BOARD) });

    const report = await run(THU_POST_CLOSE);

    expect(statusOf(report, "digest")?.status).toBe("failed");
    const [digest] = (await snapshots()).filter((r) => r.kind === "digest");
    expect(digest).toMatchObject({ tradeDate: "2026-10-08", session: "closed", parsed: null });
    expect(digest?.parseError).toBeTruthy();
    expect(digest?.rawHtml).toBe(broken);
  });

  it("scrubs the upstream key from stored raw HTML (S2)", async () => {
    const leaky = DIGEST.replace(
      "</body>",
      `<a href="/api/digest/${encodeURIComponent(KEY)}">self</a><p>${KEY}</p></body>`,
    );
    expect(leaky).not.toBe(DIGEST);
    darkfanxing = fakeDarkfanxing({ digest: html(leaky), board: html(BOARD) });

    await run(THU_POST_CLOSE);

    const [digest] = (await snapshots()).filter((r) => r.kind === "digest");
    expect(digest?.rawHtml).not.toContain(KEY);
    expect(digest?.rawHtml).not.toContain(encodeURIComponent(KEY));
    expect(digest?.rawHtml).toContain("/api/digest/***");
  });

  it("a failed or empty TWSE response fails the holidays action and keeps the stored calendar", async () => {
    const stored: MarketHoliday[] = [
      { date: "2025-12-31", name: "市場無交易，僅辦理結算交割作業", isTradingDay: false },
    ];
    await replaceHolidays(db, stored);

    const empty = await run(THU_POST_CLOSE, { twse: { fetchHolidaySchedule: async () => [] } });
    const thrown = await run(THU_POST_CLOSE, {
      twse: {
        fetchHolidaySchedule: async () => {
          throw new Error("TWSE down");
        },
      },
    });

    expect(statusOf(empty, "holidays")).toMatchObject({ status: "failed" });
    expect(statusOf(thrown, "holidays")).toMatchObject({ status: "failed", detail: "TWSE down" });
    expect(await getHolidays(db, 2025)).toEqual(stored);
    expect(statusOf(thrown, "digest")?.status).not.toBe("failed");
  });

  it("re-parses a stored unparsed closed digest before the catch-up, without an upstream fetch", async () => {
    await saveSnapshot(db, {
      kind: "digest",
      groupName: null,
      tradeDate: "2026-10-08",
      asOf: null,
      session: "closed",
      capturedAt: new Date("2026-10-08T06:00:00Z"),
      rawHtml: DIGEST,
      parsed: null,
      parseError: "old parser failed",
      parserVersion: 1,
    });

    const report = await run(THU_POST_CLOSE);

    expect(statusOf(report, "reparse")).toMatchObject({
      status: "done",
      detail: "scanned 1, fixed 1, still failing 0, conflicts 0",
    });
    expect(report.actions.map((a) => a.name).slice(0, 4)).toEqual([
      "holidays",
      "reparse",
      "digest",
      "sector_board",
    ]);
    const [digest] = (await snapshots()).filter((r) => r.kind === "digest");
    expect(digest).toMatchObject({ parseError: null, session: "closed", rawHtml: DIGEST });
    expect(digest?.parsed).not.toBeNull();
    expect(statusOf(report, "digest")?.status).toBe("skipped");
    expect(darkfanxing.requests).toEqual(["board"]);
  });

  it("skips the reparse action when nothing needs re-parsing", async () => {
    await run(THU_POST_CLOSE);

    const report = await run(THU_POST_CLOSE);

    expect(statusOf(report, "reparse")).toMatchObject({ status: "skipped" });
  });

  it("records a throwing re-parse as failed and keeps going", async () => {
    vi.mocked(reparseSnapshots).mockRejectedValue(new Error("reparse exploded"));

    const report = await run(THU_POST_CLOSE);

    expect(statusOf(report, "reparse")).toMatchObject({
      status: "failed",
      detail: "reparse exploded",
    });
    expect(statusOf(report, "digest")?.status).toBe("done");
    expect(statusOf(report, "sector_board")?.status).toBe("done");
    expect(statusOf(report, "prices:0050")?.status).toBe("done");
  });

  it("does not re-parse during intraday runs", async () => {
    const report = await run(THU_INTRADAY);

    expect(statusOf(report, "reparse")).toBeUndefined();
    expect(reparseSnapshots).not.toHaveBeenCalled();
  });

  it("uses at most 3 darkfanxing requests in any phase", async () => {
    for (const now of [THU_INTRADAY, THU_POST_CLOSE, SUN_MORNING, MON_POST_CLOSE]) {
      darkfanxing.requests.length = 0;
      await run(now);
      expect(darkfanxing.requests.length).toBeLessThanOrEqual(3);
    }
  });

  it("stores the closed digest even when an unknown-session row exists for that date (T13-b)", async () => {
    await saveSnapshot(db, {
      kind: "digest",
      groupName: null,
      tradeDate: "2026-10-08",
      asOf: null,
      session: "unknown",
      capturedAt: new Date("2026-10-08T05:00:00Z"),
      rawHtml: "<html>garbled</html>",
      parsed: null,
      parseError: "garbled",
      parserVersion: 1,
    });

    const report = await run(THU_POST_CLOSE);

    expect(statusOf(report, "digest")).toMatchObject({
      status: "done",
      detail: expect.stringContaining("closed, inserted"),
    });
    const digests = (await snapshots()).filter((r) => r.kind === "digest");
    expect(digests.map((r) => r.session).sort()).toEqual(["closed", "unknown"]);
  });

  it("skips (and later retries) when upstream serves the expected date but not yet closed", async () => {
    const notClosed = (body: string) => body.replaceAll("（收盤後）", "（盤中）");
    darkfanxing = fakeDarkfanxing({
      digest: html(notClosed(DIGEST)),
      board: html(notClosed(BOARD)),
    });

    const report = await run(THU_POST_CLOSE);

    for (const name of ["digest", "sector_board"]) {
      expect(statusOf(report, name)?.status).toBe("skipped");
      expect(statusOf(report, name)?.detail).toMatch(/^upstream session not closed yet/);
    }
    darkfanxing = fakeDarkfanxing({ digest: html(DIGEST), board: html(BOARD) });
    const retry = await run(THU_POST_CLOSE);
    expect(statusOf(retry, "digest")?.status).toBe("done");
    expect(statusOf(retry, "sector_board")?.status).toBe("done");
  });

  it("a failing price lookup fails only that symbol; the next symbol still ingests", async () => {
    vi.mocked(latestPriceDate).mockImplementation(async (database, symbol) => {
      if (symbol === "0050") throw new Error("price lookup failed");
      return actualPrices.latestPriceDate(database, symbol);
    });

    const report = await run(THU_POST_CLOSE);

    expect(statusOf(report, "prices:0050")).toEqual({
      name: "prices:0050",
      status: "failed",
      detail: "price lookup failed",
    });
    expect(statusOf(report, "corporate_actions:0050")?.status).toBe("failed");
    expect(statusOf(report, "prices:006208")?.status).toBe("done");
    expect(statusOf(report, "corporate_actions:006208")?.status).toBe("done");
    expect(await getPriceBars(db, "006208", "2026-10-08", "2026-10-08")).toHaveLength(1);
    expect(finmind.fetchPrices).not.toHaveBeenCalledWith(
      "0050",
      expect.anything(),
      expect.anything(),
    );
  });

  it("a failing calendar read records a failed action and skips only the steps that need it", async () => {
    vi.mocked(getHolidays).mockRejectedValue(new Error("calendar read failed"));

    const report = await run(THU_POST_CLOSE);

    expect(report.phase).toBeNull();
    expect(statusOf(report, "holidays")?.status).toBe("failed");
    expect(statusOf(report, "calendar")).toEqual({
      name: "calendar",
      status: "failed",
      detail: "calendar read failed",
    });
    expect(darkfanxing.requests).toEqual([]);
    expect(finmind.fetchPrices).not.toHaveBeenCalled();
  });

  describe("category members", () => {
    const etf = (symbol: string) => ({ symbol, name: symbol, industry: "ETF", market: "twse" });
    /** Bars for `symbols` on `dates`, so those symbols need neither a first backfill nor a gap fetch. */
    const seedBars = (symbols: readonly string[], dates: readonly string[]) =>
      upsertPriceBars(
        db,
        symbols.flatMap((symbol) => dates.map((date) => bar(symbol, date))),
      );
    const fetchedFrom = (symbol: string) =>
      finmind.fetchPrices.mock.calls
        .filter(([s]) => s === symbol)
        .map(([, from, to]) => [from, to]);

    it("tracks every category member once, including 00679B and 0056", () => {
      expect(TRACKED_SYMBOLS).toContain("00679B");
      expect(TRACKED_SYMBOLS).toContain("0056");
      expect(new Set(TRACKED_SYMBOLS).size).toBe(TRACKED_SYMBOLS.length);
      expect([...TRACKED_SYMBOLS].sort()).toEqual(
        [...new Set(Object.values(CATEGORY_MEMBERS).flat())].sort(),
      );
    });

    it("backfills at most 3 symbols per run and defers the rest; top-ups are not capped", async () => {
      const [a, b, c, d, e, ...rest] = TRACKED_SYMBOLS;
      // Behind by one session: a daily top-up, not a backfill.
      await seedBars(rest, ["2026-10-07"]);

      const report = await run(THU_POST_CLOSE);

      for (const symbol of [a, b, c]) {
        expect(statusOf(report, `prices:${symbol}`)?.status).toBe("done");
        expect(fetchedFrom(symbol ?? "")).toEqual([["2003-01-01", "2026-10-08"]]);
      }
      for (const symbol of [d, e]) {
        for (const name of [`prices:${symbol}`, `corporate_actions:${symbol}`]) {
          expect(statusOf(report, name)).toEqual({
            name,
            status: "skipped",
            detail: "backfill deferred",
          });
        }
        expect(fetchedFrom(symbol ?? "")).toEqual([]);
      }
      for (const symbol of rest) {
        expect(statusOf(report, `prices:${symbol}`)?.status).toBe("done");
        expect(fetchedFrom(symbol)).toEqual([["2026-10-08", "2026-10-08"]]);
      }

      finmind.fetchPrices.mockClear();
      const next = await run(THU_POST_CLOSE);
      expect(statusOf(next, `prices:${d}`)?.status).toBe("done");
      expect(statusOf(next, `prices:${e}`)?.status).toBe("done");
      expect(fetchedFrom(d ?? "")).toEqual([["2003-01-01", "2026-10-08"]]);
    });

    it("fetches a symbol's missing history once and marks it checked even when no bars return", async () => {
      await seedBars(TRACKED_SYMBOLS, ["2026-10-08"]);
      await seedBars(["0050"], ["2010-01-04"]);
      await upsertEtfUniverse(db, [etf("0050")]);
      finmind = fakeFinMind({ fetchPrices: async () => [] });

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "prices:0050:history")).toMatchObject({ status: "done" });
      expect(fetchedFrom("0050")).toEqual([["2003-01-01", "2010-01-03"]]);
      expect(finmind.fetchCorporateActions).toHaveBeenCalledWith("0050", "2003-01-01");
      const [row] = await listEtfUniverse(db);
      expect(row?.historyCheckedAt).toEqual(THU_POST_CLOSE);

      finmind.fetchPrices.mockClear();
      const second = await run(THU_POST_CLOSE);
      expect(statusOf(second, "prices:0050:history")).toBeUndefined();
      expect(finmind.fetchPrices).not.toHaveBeenCalled();
    });

    it("a complete first backfill marks history checked, so no gap fetch follows", async () => {
      await upsertEtfUniverse(db, [etf("0050")]);

      const first = await run(THU_POST_CLOSE);
      const second = await run(MON_POST_CLOSE);

      expect(statusOf(first, "prices:0050")?.status).toBe("done");
      expect((await listEtfUniverse(db))[0]?.historyCheckedAt).toEqual(THU_POST_CLOSE);
      expect(statusOf(first, "prices:0050:history")).toBeUndefined();
      expect(statusOf(second, "prices:0050:history")).toBeUndefined();
      expect(fetchedFrom("0050")).toEqual([
        ["2003-01-01", "2026-10-08"],
        ["2026-10-09", "2026-10-12"],
      ]);
    });

    it("does not fetch history for a symbol without a universe row", async () => {
      await seedBars(TRACKED_SYMBOLS, ["2026-10-08"]);
      await seedBars(["0050"], ["2010-01-04"]);

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "prices:0050:history")).toBeUndefined();
      expect(finmind.fetchPrices).not.toHaveBeenCalled();
    });

    it("does not fetch history when the stored bars already start near the backfill start", async () => {
      await seedBars(TRACKED_SYMBOLS, ["2026-10-08"]);
      await seedBars(["0050"], ["2003-02-01"]);
      await upsertEtfUniverse(db, [etf("0050")]);

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "prices:0050:history")).toBeUndefined();
      expect(finmind.fetchPrices).not.toHaveBeenCalled();
    });

    it("a gap fetch counts against the per-run backfill cap", async () => {
      const [a, b, c, d] = TRACKED_SYMBOLS;
      await seedBars(TRACKED_SYMBOLS.slice(4), ["2026-10-08"]);
      await seedBars(["0050"], ["2010-01-04", "2026-10-08"]);
      await upsertEtfUniverse(db, [etf("0050")]);
      expect(a).toBe("0050");

      const report = await run(THU_POST_CLOSE);

      // Stale first: b, c and d (no bars) take the three slots, so the gap fetch waits.
      for (const symbol of [b, c, d]) {
        expect(statusOf(report, `prices:${symbol}`)?.status).toBe("done");
      }
      expect(statusOf(report, "prices:0050:history")?.detail).toBe("backfill deferred");

      const next = await run(THU_POST_CLOSE);
      expect(statusOf(next, "prices:0050:history")?.status).toBe("done");
    });

    it("a failed history fetch is not marked checked and is retried", async () => {
      await seedBars(TRACKED_SYMBOLS, ["2026-10-08"]);
      await seedBars(["0050"], ["2010-01-04"]);
      await upsertEtfUniverse(db, [etf("0050")]);
      finmind = fakeFinMind({
        fetchCorporateActions: async () => {
          throw new Error("FinMind TaiwanStockDividendResult failed with status 500");
        },
      });

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "prices:0050:history")?.status).toBe("failed");
      expect((await listEtfUniverse(db))[0]?.historyCheckedAt).toBeNull();
      finmind = fakeFinMind({ fetchPrices: async () => [] });
      const retry = await run(THU_POST_CLOSE);
      expect(statusOf(retry, "prices:0050:history")?.status).toBe("done");
    });

    it("refreshes the ETF universe once per 7 days", async () => {
      finmind = fakeFinMind({ fetchStockInfo: async () => [etf("0050"), etf("0056")] });

      const first = await run(THU_POST_CLOSE);
      expect(statusOf(first, "etf_universe")?.status).toBe("done");
      expect((await listEtfUniverse(db)).map((r) => r.symbol)).toEqual(["0050", "0056"]);

      const second = await run(MON_POST_CLOSE);
      expect(statusOf(second, "etf_universe")?.status).toBe("skipped");
      expect(finmind.fetchStockInfo).toHaveBeenCalledTimes(1);
    });

    it("a FinMind failure in the ETF universe refresh does not abort the other actions", async () => {
      finmind = fakeFinMind({
        fetchStockInfo: async () => {
          throw new Error("FinMind TaiwanStockInfo failed with status 402: quota");
        },
      });

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "etf_universe")).toMatchObject({
        status: "failed",
        detail: expect.stringContaining("402"),
      });
      expect(statusOf(report, "digest")?.status).toBe("done");
      expect(statusOf(report, "prices:0050")?.status).toBe("done");
      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("done");
    });

    it("tops up the stalest symbols first, ties in category order", async () => {
      const [a, b, c, d, ...rest] = TRACKED_SYMBOLS;
      await seedBars(rest, ["2026-10-07"]);
      await seedBars([a ?? ""], ["2026-10-01"]);
      await seedBars([b ?? ""], ["2026-10-06"]);
      await seedBars([c ?? ""], ["2026-10-01"]);
      await seedBars([d ?? ""], ["2026-10-08"]);

      await run(THU_POST_CLOSE);

      const order = finmind.fetchPrices.mock.calls.map(([symbol]) => symbol);
      expect(order).toEqual([a, c, b, ...rest]);
    });

    it("defers symbols once the price budget is spent; briefings still start and the next run tops them up", async () => {
      expect(PRICE_RUN_BUDGET_MS).toBe(150_000);
      await seedBars(TRACKED_SYMBOLS, ["2026-10-07"]);
      let elapsed = 0;
      const clock = () => elapsed;
      // The universe refresh (before the price loop) takes the whole price budget.
      finmind = fakeFinMind({
        fetchStockInfo: async () => {
          elapsed += PRICE_RUN_BUDGET_MS;
          return [];
        },
      });

      const report = await run(THU_POST_CLOSE, { clock });

      expect(finmind.fetchPrices).not.toHaveBeenCalled();
      expect(finmind.fetchCorporateActions).not.toHaveBeenCalled();
      for (const symbol of TRACKED_SYMBOLS) {
        for (const name of [`prices:${symbol}`, `corporate_actions:${symbol}`]) {
          expect(statusOf(report, name)).toEqual({
            name,
            status: "skipped",
            detail: "price budget exhausted",
          });
        }
      }
      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("done");

      elapsed = 0;
      finmind = fakeFinMind();
      const next = await run(THU_POST_CLOSE, { clock });
      for (const symbol of TRACKED_SYMBOLS) {
        expect(statusOf(next, `prices:${symbol}`)?.status, symbol).toBe("done");
      }
    });

    it("stops starting symbols mid-loop once the injected price budget is spent", async () => {
      const [a, b, ...rest] = TRACKED_SYMBOLS;
      await seedBars(TRACKED_SYMBOLS, ["2026-10-07"]);
      let elapsed = 0;
      const clock = () => elapsed;
      finmind = fakeFinMind({
        fetchPrices: async (symbol) => {
          elapsed += 10;
          return [bar(symbol, "2026-10-08")];
        },
      });

      const report = await run(THU_POST_CLOSE, { clock, priceRunBudgetMs: 20 });

      expect(statusOf(report, `prices:${a}`)?.status).toBe("done");
      expect(statusOf(report, `prices:${b}`)?.status).toBe("done");
      for (const symbol of rest) {
        expect(statusOf(report, `prices:${symbol}`)?.detail).toBe("price budget exhausted");
      }
    });

    it("does not refresh the ETF universe during intraday runs", async () => {
      const report = await run(THU_INTRADAY);

      expect(statusOf(report, "etf_universe")).toBeUndefined();
      expect(finmind.fetchStockInfo).not.toHaveBeenCalled();
    });
  });

  describe("briefings", () => {
    const weeklyRequests = () => llm.requests.filter((r) => r.prompt.includes("2026-W41"));

    it("writes both lenses' daily and weekly briefings after the prices", async () => {
      const report = await run(THU_POST_CLOSE);

      expect(briefingNames(report)).toEqual([
        "briefing:daily:beginner",
        "briefing:daily:pro",
        "briefing:weekly:beginner",
        "briefing:weekly:pro",
      ]);
      for (const name of briefingNames(report)) expect(statusOf(report, name)?.status).toBe("done");
      const names = report.actions.map((a) => a.name);
      expect(names.indexOf("briefing:daily:beginner")).toBeGreaterThan(
        names.indexOf(`corporate_actions:${TRACKED_SYMBOLS.at(-1)}`),
      );
      for (const lens of ["beginner", "pro"] as const) {
        expect(await getBriefing(db, "daily", "2026-10-08", lens)).not.toBeNull();
        expect(await getBriefing(db, "weekly", "2026-W41", lens)).not.toBeNull();
      }
      expect(llm.requests).toHaveLength(4);
    });

    it("a second run skips every briefing without calling the LLM", async () => {
      await run(THU_POST_CLOSE);
      llm.requests.length = 0;

      const report = await run(THU_POST_CLOSE);

      expect(briefingNames(report)).toHaveLength(4);
      for (const name of briefingNames(report))
        expect(statusOf(report, name)?.status).toBe("skipped");
      expect(llm.requests).toHaveLength(0);
    });

    it("regenerates only the lens whose briefings are missing", async () => {
      await run(THU_POST_CLOSE);
      await db.delete(briefings).where(eq(briefings.lens, "pro"));
      llm.requests.length = 0;

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("skipped");
      expect(statusOf(report, "briefing:weekly:beginner")?.status).toBe("skipped");
      expect(statusOf(report, "briefing:daily:pro")?.status).toBe("done");
      expect(statusOf(report, "briefing:weekly:pro")?.status).toBe("done");
      expect(llm.requests).toHaveLength(2);
      expect(llm.requests.map(lensOf)).toEqual(["pro", "pro"]);
    });

    it("briefs the settled date when the digest action was skipped as already stored", async () => {
      llm = fakeLlm((_call, req) => UNGROUNDED(req));
      await run(THU_POST_CLOSE);
      llm = fakeLlm();

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "digest")?.status).toBe("skipped");
      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("done");
      expect(statusOf(report, "briefing:daily:pro")?.status).toBe("done");
    });

    it("feeds each day's same-lens daily summary into the weekly briefing", async () => {
      await storeDigest("2026-10-07");

      await run(THU_POST_CLOSE);

      const weekly = weeklyRequests();
      expect(weekly.map(lensOf).sort()).toEqual(["beginner", "pro"]);
      for (const request of weekly) {
        const lens = lensOf(request);
        const other = lens === "pro" ? "beginner" : "pro";
        expect(request.prompt).toContain("2026-10-07");
        expect(request.prompt).toContain(SUMMARY[lens]);
        expect(request.prompt).not.toContain(SUMMARY[other]);
      }
    });

    it("does not write a weekly briefing while the week still has trading days ahead", async () => {
      await storeDigest("2026-10-07");
      const WED_POST_CLOSE = new Date("2026-10-07T07:00:00Z");

      const report = await run(WED_POST_CLOSE, { twse: { fetchHolidaySchedule: async () => [] } });

      expect(briefingNames(report)).toEqual(["briefing:daily:beginner", "briefing:daily:pro"]);
      expect(await getBriefing(db, "weekly", "2026-W41", "beginner")).toBeNull();
    });

    describe("weekly waits for the week's final day", () => {
      const unparsedUpstream = () => {
        const broken = DIGEST.replace(/<table[\s\S]*?<\/table>/g, "<table></table>").replace(
          /<h2[\s\S]*$/,
          "",
        );
        darkfanxing = fakeDarkfanxing({ digest: html(broken), board: html(BOARD) });
      };

      it("skips the weekly when the final day's digest is unparsed, calling no weekly LLM", async () => {
        for (const date of ["2026-10-05", "2026-10-06", "2026-10-07"]) await storeDigest(date);
        unparsedUpstream();

        const report = await run(THU_POST_CLOSE);

        for (const lens of ["beginner", "pro"]) {
          expect(statusOf(report, `briefing:daily:${lens}`)?.status).toBe("skipped");
          expect(statusOf(report, `briefing:weekly:${lens}`)).toMatchObject({
            status: "skipped",
            detail: "waiting for 2026-10-08 digest",
          });
        }
        expect(weeklyRequests()).toHaveLength(0);
        expect(await getBriefing(db, "weekly", "2026-W41", "beginner")).toBeNull();
        expect(await getBriefing(db, "weekly", "2026-W41", "pro")).toBeNull();
      });

      it("skips the weekly when the final day has no daily briefing, then writes it with that summary", async () => {
        llm = fakeLlm((_call, req) => UNGROUNDED(req));
        const first = await run(THU_POST_CLOSE);

        for (const lens of ["beginner", "pro"]) {
          expect(statusOf(first, `briefing:weekly:${lens}`)).toMatchObject({
            status: "skipped",
            detail: "waiting for 2026-10-08 daily briefing",
          });
        }
        expect(weeklyRequests()).toHaveLength(0);
        expect(await getBriefing(db, "weekly", "2026-W41", "beginner")).toBeNull();

        llm = fakeLlm();
        const second = await run(THU_POST_CLOSE);

        expect(statusOf(second, "briefing:daily:beginner")?.status).toBe("done");
        expect(statusOf(second, "briefing:weekly:beginner")?.status).toBe("done");
        expect(statusOf(second, "briefing:weekly:pro")?.status).toBe("done");
        for (const request of weeklyRequests()) {
          expect(request.prompt).toContain(SUMMARY[lensOf(request)]);
        }
        expect(weeklyRequests()).toHaveLength(2);
      });
    });

    it("after the first thrown LLM error, skips every remaining briefing without calling the LLM", async () => {
      await storeDigest("2026-10-07");
      llm = fakeLlm(() => {
        throw new Error("LLM timed out");
      });

      const report = await run(THU_POST_CLOSE);

      expect(llm.requests).toHaveLength(1);
      const names = briefingNames(report);
      expect(names).toEqual([
        "briefing:daily:beginner",
        "briefing:daily:pro",
        "briefing:daily:beginner:2026-10-07",
        "briefing:daily:pro:2026-10-07",
        "briefing:weekly:beginner",
        "briefing:weekly:pro",
      ]);
      expect(statusOf(report, names[0] ?? "")).toMatchObject({
        status: "failed",
        detail: "LLM timed out",
      });
      for (const name of names.slice(1)) {
        expect(statusOf(report, name)).toMatchObject({
          status: "skipped",
          detail: "LLM unavailable earlier in this run",
        });
      }
      expect(statusOf(report, "digest")?.status).toBe("done");
      expect(statusOf(report, "sector_board")?.status).toBe("done");
      expect(statusOf(report, "prices:0050")?.status).toBe("done");

      llm = fakeLlm();
      const recovery = await run(THU_POST_CLOSE);

      for (const name of names) expect(statusOf(recovery, name)?.status).toBe("done");
    });

    it("skips every briefing action that would start after the run time budget, and the next run continues", async () => {
      expect(BRIEFING_RUN_BUDGET_MS).toBe(270_000);
      await storeDigest("2026-10-07");
      let elapsed = 0;
      const clock = () => elapsed;
      // The first LLM call takes the whole budget.
      llm = fakeLlm((call, req) => {
        if (call === 1) elapsed += BRIEFING_RUN_BUDGET_MS;
        return contentFor(req);
      });

      const report = await run(THU_POST_CLOSE, { clock });

      expect(llm.requests).toHaveLength(1);
      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("done");
      const rest = briefingNames(report).filter((name) => name !== "briefing:daily:beginner");
      expect(rest).toEqual([
        "briefing:daily:pro",
        "briefing:weekly:beginner",
        "briefing:weekly:pro",
      ]);
      for (const name of rest) {
        expect(statusOf(report, name)).toMatchObject({
          status: "skipped",
          detail: "run time budget exhausted",
        });
      }
      expect(statusOf(report, "prices:0050")?.status).toBe("done");

      // A new run gets a fresh budget (its own start time) and carries on.
      llm = fakeLlm();
      const next = await run(THU_POST_CLOSE, { clock });
      expect(statusOf(next, "briefing:daily:beginner")?.status).toBe("skipped");
      for (const name of [
        "briefing:daily:pro",
        "briefing:daily:beginner:2026-10-07",
        "briefing:daily:pro:2026-10-07",
        "briefing:weekly:beginner",
        "briefing:weekly:pro",
      ]) {
        expect(statusOf(next, name)?.status, name).toBe("done");
      }
    });

    it("honours an injected budget measured from the start of the run", async () => {
      let elapsed = 0;
      const clock = () => elapsed;
      llm = fakeLlm((_call, req) => {
        elapsed += 10;
        return contentFor(req);
      });

      const report = await run(THU_POST_CLOSE, { clock, briefingRunBudgetMs: 10 });

      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("done");
      expect(statusOf(report, "briefing:daily:pro")).toMatchObject({
        status: "skipped",
        detail: "run time budget exhausted",
      });
    });

    it("a rejected lens does not stop the other", async () => {
      llm = fakeLlm((_call, req) =>
        lensOf(req) === "beginner" ? UNGROUNDED(req) : contentFor(req),
      );

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "briefing:daily:beginner")).toMatchObject({
        status: "skipped",
        detail: expect.stringContaining("7.77"),
      });
      expect(statusOf(report, "briefing:daily:pro")?.status).toBe("done");
      expect(await getBriefing(db, "daily", "2026-10-08", "pro")).not.toBeNull();
      expect(await getBriefing(db, "daily", "2026-10-08", "beginner")).toBeNull();
    });

    it("skips the briefing when the settled date's digest is unparsed", async () => {
      const broken = DIGEST.replace(/<table[\s\S]*?<\/table>/g, "<table></table>").replace(
        /<h2[\s\S]*$/,
        "",
      );
      darkfanxing = fakeDarkfanxing({ digest: html(broken), board: html(BOARD) });

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("skipped");
      expect(statusOf(report, "briefing:daily:pro")?.status).toBe("skipped");
      expect(statusOf(report, "briefing:weekly:beginner")).toMatchObject({
        status: "skipped",
        detail: "waiting for 2026-10-08 digest",
      });
      expect(llm.requests).toHaveLength(0);
    });

    it("briefs the settled date for both lenses, then earlier unbriefed digests oldest first", async () => {
      await storeDigest("2026-10-07");

      const report = await run(THU_POST_CLOSE);

      expect(briefingNames(report).slice(0, 4)).toEqual([
        "briefing:daily:beginner",
        "briefing:daily:pro",
        "briefing:daily:beginner:2026-10-07",
        "briefing:daily:pro:2026-10-07",
      ]);
      expect(statusOf(report, "briefing:daily:pro:2026-10-07")?.status).toBe("done");
      expect(await getBriefing(db, "daily", "2026-10-07", "beginner")).not.toBeNull();
      expect(await getBriefing(db, "daily", "2026-10-07", "pro")).not.toBeNull();
    });

    it("briefs at most the 4 most recent earlier dates within 14 days, plus the settled one", async () => {
      const dates = [
        "2026-09-20", // older than the 14-day window
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
      ];
      for (const date of dates) await storeDigest(date);

      const report = await run(THU_POST_CLOSE);

      const names = briefingNames(report);
      expect(names.filter((n) => n.startsWith("briefing:daily:beginner"))).toEqual([
        "briefing:daily:beginner",
        "briefing:daily:beginner:2026-10-02",
        "briefing:daily:beginner:2026-10-05",
        "briefing:daily:beginner:2026-10-06",
        "briefing:daily:beginner:2026-10-07",
      ]);
      for (const name of names) expect(statusOf(report, name)?.status).toBe("done");
      // (1 settled + 4 earlier) daily per lens, plus the weekly per lens.
      expect(llm.requests).toHaveLength(2 * 5 + 2);
      expect(await getBriefing(db, "daily", "2026-10-01", "beginner")).toBeNull();
      expect(await getBriefing(db, "daily", "2026-09-20", "pro")).toBeNull();
    });

    it("ignores an earlier digest whose stored shape no longer validates", async () => {
      await saveSnapshot(db, {
        kind: "digest",
        groupName: null,
        tradeDate: "2026-10-07",
        asOf: null,
        session: "closed",
        capturedAt: new Date("2026-10-07T07:00:00Z"),
        rawHtml: "<html></html>",
        parsed: { bogus: true },
        parseError: null,
        parserVersion: PARSER_VERSION,
      });
      const warn = vi.spyOn(silent, "warn");

      const report = await run(THU_POST_CLOSE);

      expect(briefingNames(report).filter((n) => n.includes("2026-10-07"))).toEqual([]);
      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("done");
      // Read by both lenses' catch-up scans and by the weekly assembly, but logged once per run.
      const invalid = warn.mock.calls.filter(
        ([, message]) => message === "stored digest no longer validates",
      );
      expect(invalid).toHaveLength(1);
      warn.mockRestore();
    });

    it("writes no briefings during an intraday run", async () => {
      const report = await run(THU_INTRADAY);

      expect(briefingNames(report)).toEqual([]);
      expect(llm.requests).toHaveLength(0);
    });
  });

  describe("plan explanations", () => {
    /** 2026-10-15 15:00 Taipei, the plan fixtures' "today". */
    const PLAN_POST_CLOSE = new Date("2026-10-15T07:00:00Z");
    const planNames = (report: IngestionReport) =>
      report.actions.map((a) => a.name).filter((name) => name.startsWith("plan_explanation:"));
    const PLAN_NAMES = [1, 2, 3, 4, 5].flatMap((level) =>
      (["beginner", "pro"] as const).map((lens) => `plan_explanation:${level}:${lens}`),
    );
    /** Grounded for every level: it has no numbers. */
    const PLAN_CONTENT: BriefingContent = {
      headline: "這個配置分成幾個部位",
      summary: "核心、債券、高股息、衛星和現金各有各的角色。",
      sections: [
        { title: "這段期間的表現", body: "在這段資料期間，這個組合曾經有漲有跌。" },
        { title: "用白話看這個配置", body: "最大回撤像爬山時從山頂往下走的最深一段。" },
      ],
      takeaway: "以上為資料整理與教育說明，不構成投資建議。",
      termIds: [],
    };

    /** The briefings' catch-up also calls the LLM (the upstream fixture serves 2026-10-08). */
    const planRequests = () => llm.requests.filter((r) => r.system.includes("資產配置解說員"));

    beforeEach(async () => {
      await seedPlanMarket(db);
      // Keep the synthetic plan series intact: the price top-ups add nothing.
      finmind = fakeFinMind({ fetchPrices: async () => [] });
      llm = fakeLlm(() => PLAN_CONTENT);
    });

    it("writes the 10 explanations after the briefings in a post-close run", async () => {
      const report = await run(PLAN_POST_CLOSE);

      expect(planNames(report)).toEqual(PLAN_NAMES);
      for (const name of PLAN_NAMES) expect(statusOf(report, name)?.status, name).toBe("done");
      const names = report.actions.map((a) => a.name);
      expect(names.indexOf(PLAN_NAMES[0] ?? "")).toBeGreaterThan(
        names.lastIndexOf(briefingNames(report).at(-1) ?? ""),
      );
      expect(planRequests()).toHaveLength(10);
      expect(await db.select().from(planExplanations)).toHaveLength(10);

      llm.requests.length = 0;
      const again = await run(PLAN_POST_CLOSE);
      for (const name of PLAN_NAMES) {
        expect(statusOf(again, name)).toMatchObject({
          status: "skipped",
          detail: "already stored",
        });
      }
      expect(llm.requests).toHaveLength(0);
    });

    it("writes no explanations during an intraday run", async () => {
      const report = await run(new Date("2026-10-15T02:30:00Z"));

      expect(planNames(report)).toEqual([]);
      expect(llm.requests).toHaveLength(0);
    });

    it.each([
      ["closed-day", new Date("2026-10-09T02:00:00Z")], // Friday 2026-10-09 10:00, a holiday
      ["pre-open", new Date("2026-10-15T00:00:00Z")], // Thursday 2026-10-15 08:00
    ] as const)("writes no explanations in a %s run", async (phase, now) => {
      const report = await run(now);

      expect(report.phase).toBe(phase);
      expect(planNames(report)).toEqual([]);
      expect(planRequests()).toHaveLength(0);

      const postClose = await run(PLAN_POST_CLOSE);
      expect(planNames(postClose)).toEqual(PLAN_NAMES);
      expect(planRequests()).toHaveLength(10);
    });

    it("skips every explanation when the briefings already found the LLM down", async () => {
      await storeDigest("2026-10-15");
      llm = fakeLlm(() => {
        throw new Error("LLM timed out");
      });

      const report = await run(PLAN_POST_CLOSE);

      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("failed");
      expect(llm.requests).toHaveLength(1);
      for (const name of PLAN_NAMES) {
        expect(statusOf(report, name)).toMatchObject({
          status: "skipped",
          detail: "LLM unavailable earlier in this run",
        });
      }
      expect(report.phase).toBe("post-close");
    });

    it("skips every explanation once the run time budget is spent", async () => {
      const report = await run(PLAN_POST_CLOSE, { briefingRunBudgetMs: 0 });

      for (const name of PLAN_NAMES) {
        expect(statusOf(report, name)).toMatchObject({
          status: "skipped",
          detail: "run time budget exhausted",
        });
      }
      expect(llm.requests).toHaveLength(0);
    });
  });
});
