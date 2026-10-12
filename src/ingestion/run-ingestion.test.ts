import { readFileSync } from "node:fs";
import { asc } from "drizzle-orm";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { getBriefing } from "@/db/repositories/briefings";
import { getHolidays, replaceHolidays } from "@/db/repositories/calendar";
import { getPriceBars, latestPriceDate } from "@/db/repositories/prices";
import { saveSnapshot } from "@/db/repositories/snapshots";
import { marketSnapshots } from "@/db/schema";
import type { BriefingContent } from "@/insight/briefing-content";
import type { GenerateObjectRequest, Llm } from "@/insight/llm";
import { createDarkfanxingClient, parseDigest } from "@/sources/darkfanxing";
import type { FinMindClient, PriceBar } from "@/sources/finmind";
import { createTwseClient, type MarketHoliday, type TwseClient } from "@/sources/twse";
import { createTestDb } from "../../test/helpers/test-db";
import { reparseSnapshots } from "./reparse";
import { type IngestionReport, runIngestion } from "./run-ingestion";
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

/** Numbers here all appear in the 2026-10-08 fixture's daily and (single-day) weekly fact sheets. */
const CONTENT: BriefingContent = {
  headline: "台指期收 49349 點",
  summary: "上漲族群 87、下跌族群 88，漲跌幾乎各半。",
  sections: [
    { title: "大盤節奏", body: "多數族群小漲，但跌的族群跌得比較深。" },
    { title: "這對你意味著什麼", body: "像班上一半同學考好、一半考差，平均分數看不出全貌。" },
  ],
  takeaway: "本內容僅供學習參考，不構成投資建議。",
  termIds: [],
};

type LlmBehavior = (call: number, req: GenerateObjectRequest<unknown>) => BriefingContent;

/** A fake LLM answering every call with `CONTENT` unless `behavior` says otherwise (it may throw). */
function fakeLlm(behavior: LlmBehavior = () => CONTENT) {
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

  describe("briefings", () => {
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

    it("feeds each day's same-lens daily summary into the weekly briefing", async () => {
      await storeDigest("2026-10-07");

      await run(THU_POST_CLOSE);

      const weekly = llm.requests.filter((r) => r.prompt.includes("2026-W41"));
      expect(weekly).toHaveLength(2);
      for (const request of weekly) {
        expect(request.prompt).toContain("2026-10-07");
        expect(request.prompt).toContain(CONTENT.summary);
      }
    });

    it("does not write a weekly briefing while the week still has trading days ahead", async () => {
      await storeDigest("2026-10-07");
      const WED_POST_CLOSE = new Date("2026-10-07T07:00:00Z");

      const report = await run(WED_POST_CLOSE, { twse: { fetchHolidaySchedule: async () => [] } });

      expect(briefingNames(report)).toEqual(["briefing:daily:beginner", "briefing:daily:pro"]);
      expect(await getBriefing(db, "weekly", "2026-W41", "beginner")).toBeNull();
    });

    it("an LLM outage fails the briefing actions but not digest, board or prices", async () => {
      llm = fakeLlm(() => {
        throw new Error("LLM timed out");
      });

      const report = await run(THU_POST_CLOSE);

      for (const name of briefingNames(report)) {
        expect(statusOf(report, name)).toMatchObject({
          status: "failed",
          detail: "LLM timed out",
        });
      }
      expect(briefingNames(report)).toHaveLength(4);
      expect(statusOf(report, "digest")?.status).toBe("done");
      expect(statusOf(report, "sector_board")?.status).toBe("done");
      expect(statusOf(report, "prices:0050")?.status).toBe("done");
    });

    it("one failing lens does not stop the other", async () => {
      llm = fakeLlm((call) => {
        if (call === 1) throw new Error("first call failed");
        return CONTENT;
      });

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("failed");
      expect(statusOf(report, "briefing:daily:pro")?.status).toBe("done");
      expect(await getBriefing(db, "daily", "2026-10-08", "pro")).not.toBeNull();
      expect(await getBriefing(db, "daily", "2026-10-08", "beginner")).toBeNull();
    });

    it("records a rejected briefing as skipped with the reasons, storing nothing", async () => {
      llm = fakeLlm(() => ({ ...CONTENT, summary: "成交量放大到 7.77 兆。" }));

      const report = await run(THU_POST_CLOSE);

      expect(statusOf(report, "briefing:daily:beginner")).toMatchObject({
        status: "skipped",
        detail: expect.stringContaining("7.77"),
      });
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
        detail: expect.stringContaining("no parsed closed digest"),
      });
      expect(llm.requests).toHaveLength(0);
    });

    it("briefs an earlier closed digest that lacks a briefing, oldest first", async () => {
      await storeDigest("2026-10-07");

      const report = await run(THU_POST_CLOSE);

      expect(briefingNames(report).slice(0, 4)).toEqual([
        "briefing:daily:beginner",
        "briefing:daily:beginner:2026-10-07",
        "briefing:daily:pro",
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

      const beginnerDaily = briefingNames(report).filter((n) =>
        n.startsWith("briefing:daily:beginner"),
      );
      expect(beginnerDaily).toEqual([
        "briefing:daily:beginner",
        "briefing:daily:beginner:2026-10-02",
        "briefing:daily:beginner:2026-10-05",
        "briefing:daily:beginner:2026-10-06",
        "briefing:daily:beginner:2026-10-07",
      ]);
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

      const report = await run(THU_POST_CLOSE);

      expect(briefingNames(report).filter((n) => n.includes("2026-10-07"))).toEqual([]);
      expect(statusOf(report, "briefing:daily:beginner")?.status).toBe("done");
    });

    it("writes no briefings during an intraday run", async () => {
      const report = await run(THU_INTRADAY);

      expect(briefingNames(report)).toEqual([]);
      expect(llm.requests).toHaveLength(0);
    });
  });
});
