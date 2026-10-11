import { readFileSync } from "node:fs";
import { asc } from "drizzle-orm";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { getHolidays, replaceHolidays } from "@/db/repositories/calendar";
import { getPriceBars, latestPriceDate } from "@/db/repositories/prices";
import { saveSnapshot } from "@/db/repositories/snapshots";
import { marketSnapshots } from "@/db/schema";
import { createDarkfanxingClient } from "@/sources/darkfanxing";
import type { FinMindClient, PriceBar } from "@/sources/finmind";
import { createTwseClient, type MarketHoliday, type TwseClient } from "@/sources/twse";
import { createTestDb } from "../../test/helpers/test-db";
import { type IngestionReport, runIngestion } from "./run-ingestion";
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

const statusOf = (report: IngestionReport, name: string) =>
  report.actions.find((action) => action.name === name);

describe("runIngestion", () => {
  let db: Db;
  let darkfanxing: ReturnType<typeof fakeDarkfanxing>;
  let finmind: ReturnType<typeof fakeFinMind>;
  let twse: TwseClient;

  const run = (now: Date, overrides: Partial<Parameters<typeof runIngestion>[0]> = {}) =>
    runIngestion({
      db,
      darkfanxing: darkfanxing.client,
      darkfanxingKey: KEY,
      finmind,
      twse,
      now,
      logger: silent,
      ...overrides,
    });

  const snapshots = () =>
    db
      .select()
      .from(marketSnapshots)
      .orderBy(asc(marketSnapshots.kind), asc(marketSnapshots.tradeDate));

  beforeEach(async () => {
    vi.mocked(getHolidays).mockImplementation(actualCalendar.getHolidays);
    vi.mocked(latestPriceDate).mockImplementation(actualPrices.latestPriceDate);
    db = await createTestDb();
    darkfanxing = fakeDarkfanxing({ digest: html(DIGEST), board: html(BOARD) });
    finmind = fakeFinMind();
    twse = fixtureTwse();
  });

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

    for (const symbol of TRACKED_SYMBOLS) {
      expect(statusOf(report, `prices:${symbol}`)?.status).toBe("done");
      expect(statusOf(report, `corporate_actions:${symbol}`)?.status).toBe("done");
      expect(finmind.fetchPrices).toHaveBeenCalledWith(symbol, "2010-01-01", "2026-10-08");
      expect(finmind.fetchCorporateActions).toHaveBeenCalledWith(symbol, "2010-01-01");
      expect(await getPriceBars(db, symbol, "2026-10-08", "2026-10-08")).toHaveLength(1);
    }
    expect((await getHolidays(db, 2026)).length).toBeGreaterThan(0);
  });

  it("a second identical run skips everything and inserts no duplicates", async () => {
    await run(THU_POST_CLOSE);
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
});
