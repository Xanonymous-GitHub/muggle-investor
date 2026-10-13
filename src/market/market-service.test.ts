import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { latestSnapshot, type NewSnapshot, saveSnapshot } from "@/db/repositories/snapshots";
import { marketSnapshots } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { createRateLimiter } from "@/lib/rate-limiter";
import {
  createDarkfanxingClient,
  type DarkfanxingClient,
  type Fetched,
  parseDigest,
  parseSectorBoard,
  parseSectorDetail,
  type SectorDetail,
} from "@/sources/darkfanxing";
import { createTestDb } from "../../test/helpers/test-db";
import {
  getSectorBoard,
  getSectorDetail,
  getToday,
  isValidGroupName,
  SectorDetailBusyError,
  type SectorDetailDeps,
} from "./market-service";
import { createOnDemandBudget } from "./on-demand-budget";

vi.mock("@/lib/logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

const fixture = (name: string) => readFileSync(`test/fixtures/darkfanxing/${name}`, "utf8");
const DIGEST_HTML = fixture("digest-2026-10-08.html");
const BOARD_HTML = fixture("now-2026-10-08.html");
const DETAIL_HTML = fixture("group-quartz-2026-10-08.html");
const GROUP = "石英元件";
const KEY = "test+key/0123456789abcdef";

/** Taipei wall-clock instants (UTC+8). */
const THU_INTRADAY = new Date("2026-10-08T02:30:00Z"); // 10:30
const THU_POST_CLOSE = new Date("2026-10-08T07:00:00Z"); // 15:00
const minutesBefore = (date: Date, minutes: number) => new Date(date.getTime() - minutes * 60_000);

const DIGEST = parseDigest(DIGEST_HTML);
const BOARD = parseSectorBoard(BOARD_HTML);

const row = (overrides: Partial<NewSnapshot>): NewSnapshot => ({
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

const detailRow = (overrides: Partial<NewSnapshot>): NewSnapshot =>
  row({
    kind: "sector_detail",
    groupName: GROUP,
    session: "unknown",
    asOf: "10:20",
    parsed: { ...parseSectorDetail(DETAIL_HTML), asOf: "10:20" },
    ...overrides,
  });

function fakeClient(raw = DETAIL_HTML, fetchedAt = THU_INTRADAY) {
  const fetchSectorDetail = vi.fn<DarkfanxingClient["fetchSectorDetail"]>(
    async (): Promise<Fetched<SectorDetail>> => {
      let parsed: SectorDetail | null = null;
      let parseError: string | null = null;
      try {
        parsed = parseSectorDetail(raw);
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
      return { raw, parsed, parseError, meta: null, fetchedAt };
    },
  );
  const client: DarkfanxingClient = {
    fetchDigest: vi.fn(),
    fetchSectorBoard: vi.fn(),
    fetchSectorDetail,
  };
  return { client, fetchSectorDetail };
}

describe("market service", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  const deps = (
    client: DarkfanxingClient,
    now: Date,
    overrides: Partial<SectorDetailDeps> = {},
  ): SectorDetailDeps => ({
    db,
    darkfanxing: client,
    darkfanxingKey: KEY,
    now,
    holidays: [],
    // generous by default so only the budget tests are throttled
    detailBudget: createOnDemandBudget({ limit: 100, windowMs: 60_000 }),
    ...overrides,
  });

  describe("getSectorDetail", () => {
    beforeEach(async () => {
      await saveSnapshot(db, row({}));
    });

    it("intraday: a detail captured 3 minutes ago is served without calling upstream", async () => {
      const cached = detailRow({ capturedAt: minutesBefore(THU_INTRADAY, 3) });
      await saveSnapshot(db, cached);
      const { client, fetchSectorDetail } = fakeClient();

      const detail = await getSectorDetail(deps(client, THU_INTRADAY), GROUP);

      expect(detail?.asOf).toBe("10:20");
      expect(fetchSectorDetail).not.toHaveBeenCalled();
    });

    it("intraday: a detail captured 6 minutes ago is refetched once and saved", async () => {
      await saveSnapshot(db, detailRow({ capturedAt: minutesBefore(THU_INTRADAY, 6) }));
      const { client, fetchSectorDetail } = fakeClient();

      const detail = await getSectorDetail(deps(client, THU_INTRADAY), GROUP);

      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);
      expect(fetchSectorDetail).toHaveBeenCalledWith(GROUP, { nonBlocking: true });
      expect(detail?.group).toBe(GROUP);
      const saved = await latestSnapshot(db, "sector_detail", { groupName: GROUP });
      expect(saved?.capturedAt).toEqual(THU_INTRADAY);
      expect(saved?.asOf).toBe("13:34");
    });

    it("intraday with no cached detail: fetches and saves", async () => {
      const { client, fetchSectorDetail } = fakeClient();
      await getSectorDetail(deps(client, THU_INTRADAY), GROUP);
      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);
      expect((await latestSnapshot(db, "sector_detail", { groupName: GROUP }))?.tradeDate).toBe(
        "2026-10-08",
      );
    });

    it("post-close: a detail captured after the 13:35 settlement of the board's date is served", async () => {
      await saveSnapshot(db, detailRow({ capturedAt: new Date("2026-10-08T05:40:00Z") })); // 13:40
      const { client, fetchSectorDetail } = fakeClient();

      const detail = await getSectorDetail(deps(client, THU_POST_CLOSE), GROUP);

      expect(detail?.tradeDate).toBe("2026-10-08");
      expect(fetchSectorDetail).not.toHaveBeenCalled();
    });

    it("post-close: a detail captured at 11:00 on the trade date is intraday data and is refetched", async () => {
      await saveSnapshot(db, detailRow({ capturedAt: new Date("2026-10-08T03:00:00Z") })); // 11:00
      const { client, fetchSectorDetail } = fakeClient(DETAIL_HTML, THU_POST_CLOSE);

      await getSectorDetail(deps(client, THU_POST_CLOSE), GROUP);

      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);
      const saved = await latestSnapshot(db, "sector_detail", { groupName: GROUP });
      expect(saved?.capturedAt).toEqual(THU_POST_CLOSE);
    });

    it("post-close: a detail from an earlier trade date is refetched", async () => {
      await saveSnapshot(
        db,
        detailRow({
          tradeDate: "2026-10-07",
          capturedAt: new Date("2026-10-07T07:00:00Z"),
          parsed: { ...parseSectorDetail(DETAIL_HTML), tradeDate: "2026-10-07" },
        }),
      );
      const { client, fetchSectorDetail } = fakeClient(DETAIL_HTML, THU_POST_CLOSE);
      await getSectorDetail(deps(client, THU_POST_CLOSE), GROUP);
      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);
    });

    it("settling is treated like intraday: only a fresh detail is reused", async () => {
      const settling = new Date("2026-10-08T05:45:00Z"); // 13:45
      await saveSnapshot(db, detailRow({ capturedAt: minutesBefore(settling, 10) }));
      const { client, fetchSectorDetail } = fakeClient(DETAIL_HTML, settling);
      await getSectorDetail(deps(client, settling), GROUP);
      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);
    });

    it("unknown group: null, upstream untouched", async () => {
      const { client, fetchSectorDetail } = fakeClient();
      expect(await getSectorDetail(deps(client, THU_INTRADAY), "不存在")).toBeNull();
      expect(fetchSectorDetail).not.toHaveBeenCalled();
    });

    it("no board stored yet: null, upstream untouched", async () => {
      const empty = await createTestDb();
      const { client, fetchSectorDetail } = fakeClient();
      expect(await getSectorDetail(deps(client, THU_INTRADAY, { db: empty }), GROUP)).toBeNull();
      expect(fetchSectorDetail).not.toHaveBeenCalled();
    });

    it("rejects over-long and control-character names before any lookup", async () => {
      const { client, fetchSectorDetail } = fakeClient();
      for (const bad of ["", "a".repeat(65), `${GROUP}\n`, `${GROUP}\u0000`, `\u007f${GROUP}`]) {
        expect(isValidGroupName(bad)).toBe(false);
        expect(await getSectorDetail(deps(client, THU_INTRADAY), bad)).toBeNull();
      }
      expect(isValidGroupName(GROUP)).toBe(true);
      expect(isValidGroupName("a".repeat(64))).toBe(true);
      expect(fetchSectorDetail).not.toHaveBeenCalled();
    });

    it("stores the raw body without the upstream key", async () => {
      const leaky = DETAIL_HTML.replace(
        "</body>",
        `<!-- ${KEY} ${encodeURIComponent(KEY)} --></body>`,
      );
      const { client } = fakeClient(leaky);
      await getSectorDetail(deps(client, THU_INTRADAY), GROUP);
      // latestSnapshot leaves raw_html out, so read the full row.
      const [saved] = await db
        .select()
        .from(marketSnapshots)
        .where(eq(marketSnapshots.groupName, GROUP));
      expect(saved?.rawHtml).not.toContain(KEY);
      expect(saved?.rawHtml).not.toContain(encodeURIComponent(KEY));
      expect(saved?.rawHtml).toContain("***");
    });

    it("with nothing stored, an upstream body that fails to parse is saved raw and surfaces as an error", async () => {
      const { client } = fakeClient("<html><body><h1>maintenance</h1></body></html>");
      await expect(getSectorDetail(deps(client, THU_INTRADAY), GROUP)).rejects.toThrow(
        /sector detail/,
      );
      const saved = await latestSnapshot(db, "sector_detail", { groupName: GROUP });
      expect(saved?.parsed).toBeNull();
      expect(saved?.parseError).toBeTruthy();
      // an unparsable row is never served from cache
      const { client: second, fetchSectorDetail } = fakeClient();
      await getSectorDetail(deps(second, THU_INTRADAY), GROUP);
      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);
    });

    it("upstream HTTP failure with a stale stored detail: serves the stored one", async () => {
      await saveSnapshot(db, detailRow({ capturedAt: minutesBefore(THU_INTRADAY, 6) }));
      const { client, fetchSectorDetail } = fakeClient();
      fetchSectorDetail.mockRejectedValue(new HttpError(502, "https://upstream/***", "HTTP 502"));

      const detail = await getSectorDetail(deps(client, THU_INTRADAY), GROUP);

      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);
      expect(detail?.asOf).toBe("10:20");
    });

    it("unparsable upstream body with a stale stored detail: saves the raw, serves the stored one", async () => {
      await saveSnapshot(db, detailRow({ capturedAt: minutesBefore(THU_INTRADAY, 6) }));
      const { client } = fakeClient("<html><body><h1>maintenance</h1></body></html>");

      const detail = await getSectorDetail(deps(client, THU_INTRADAY), GROUP);

      expect(detail?.asOf).toBe("10:20");
      const latest = await latestSnapshot(db, "sector_detail", { groupName: GROUP });
      expect(latest?.parseError).toBeTruthy();
    });

    it("upstream HTTP failure with nothing stored: rethrows", async () => {
      const { client, fetchSectorDetail } = fakeClient();
      const failure = new HttpError(502, "https://upstream/***", "HTTP 502");
      fetchSectorDetail.mockRejectedValue(failure);

      await expect(getSectorDetail(deps(client, THU_INTRADAY), GROUP)).rejects.toBe(failure);
    });

    it("concurrent requests for one group share a single upstream call", async () => {
      const { client, fetchSectorDetail } = fakeClient();
      const [a, b] = await Promise.all([
        getSectorDetail(deps(client, THU_INTRADAY), GROUP),
        getSectorDetail(deps(client, THU_INTRADAY), GROUP),
      ]);
      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    });
  });

  describe("getSectorDetail quota protection", () => {
    const SIXTY_ONE_S = 61_000;
    beforeEach(async () => {
      await saveSnapshot(db, row({}));
    });

    it("refreshes captured_at when upstream repeats the same as-of, so the TTL holds", async () => {
      const sameAsOf = { ...parseSectorDetail(DETAIL_HTML) }; // as-of 13:34, same as upstream's
      await saveSnapshot(
        db,
        detailRow({
          asOf: sameAsOf.asOf,
          parsed: sameAsOf,
          capturedAt: minutesBefore(THU_INTRADAY, 6),
        }),
      );
      const { client, fetchSectorDetail } = fakeClient();

      await getSectorDetail(deps(client, THU_INTRADAY), GROUP);
      await getSectorDetail(deps(client, THU_INTRADAY), GROUP);

      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);
      const saved = await latestSnapshot(db, "sector_detail", { groupName: GROUP });
      expect(saved?.capturedAt).toEqual(THU_INTRADAY);
    });

    it("budget exhausted with a stale cached detail: serves it, no upstream call", async () => {
      const detailBudget = createOnDemandBudget({ limit: 1, windowMs: 60_000 });
      detailBudget.tryTake(THU_INTRADAY.getTime());
      await saveSnapshot(db, detailRow({ capturedAt: minutesBefore(THU_INTRADAY, 6) }));
      const { client, fetchSectorDetail } = fakeClient();

      const detail = await getSectorDetail(deps(client, THU_INTRADAY, { detailBudget }), GROUP);

      expect(detail?.asOf).toBe("10:20");
      expect(fetchSectorDetail).not.toHaveBeenCalled();
    });

    it("budget exhausted with nothing cached: busy, with a retry hint, no upstream call", async () => {
      const detailBudget = createOnDemandBudget({ limit: 1, windowMs: 60_000 });
      detailBudget.tryTake(THU_INTRADAY.getTime());
      const { client, fetchSectorDetail } = fakeClient();

      const error = await getSectorDetail(
        deps(client, THU_INTRADAY, { detailBudget }),
        GROUP,
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SectorDetailBusyError);
      expect((error as SectorDetailBusyError).retryAfterSeconds).toBe(60);
      expect(fetchSectorDetail).not.toHaveBeenCalled();
    });

    it("spends one token per upstream fetch and refills after the window", async () => {
      const detailBudget = createOnDemandBudget({ limit: 1, windowMs: 60_000 });
      const [first, second] = BOARD.sectors.map((sector) => sector.name);
      const { client, fetchSectorDetail } = fakeClient();

      await getSectorDetail(deps(client, THU_INTRADAY, { detailBudget }), first as string);
      await expect(
        getSectorDetail(deps(client, THU_INTRADAY, { detailBudget }), second as string),
      ).rejects.toBeInstanceOf(SectorDetailBusyError);
      expect(fetchSectorDetail).toHaveBeenCalledTimes(1);

      const later = new Date(THU_INTRADAY.getTime() + SIXTY_ONE_S);
      await getSectorDetail(deps(client, later, { detailBudget }), second as string);
      expect(fetchSectorDetail).toHaveBeenCalledTimes(2);
    });

    describe("shared darkfanxing limiter drained", () => {
      const drainedClient = () => {
        const limiter = createRateLimiter({ capacity: 1, refillEveryMs: 60_000 });
        limiter.tryAcquire();
        const fetchImpl = vi.fn(async () => new Response(DETAIL_HTML));
        const client = createDarkfanxingClient({
          baseUrl: "https://upstream.test",
          key: KEY,
          limiter,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          sleep: async () => {
            throw new Error("the on-demand path must never wait");
          },
        });
        return { client, fetchImpl };
      };

      it("nothing stored: busy with a retry hint, no upstream call, never waits", async () => {
        const { client, fetchImpl } = drainedClient();

        const error = await getSectorDetail(deps(client, THU_INTRADAY), GROUP).catch(
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(SectorDetailBusyError);
        expect((error as SectorDetailBusyError).retryAfterSeconds).toBe(60);
        expect(fetchImpl).not.toHaveBeenCalled();
      });

      it("stale detail stored: serves it, no upstream call", async () => {
        await saveSnapshot(db, detailRow({ capturedAt: minutesBefore(THU_INTRADAY, 6) }));
        const { client, fetchImpl } = drainedClient();

        const detail = await getSectorDetail(deps(client, THU_INTRADAY), GROUP);

        expect(detail?.asOf).toBe("10:20");
        expect(fetchImpl).not.toHaveBeenCalled();
      });
    });

    it("cache hits cost no budget", async () => {
      const detailBudget = createOnDemandBudget({ limit: 1, windowMs: 60_000 });
      await saveSnapshot(db, detailRow({ capturedAt: minutesBefore(THU_INTRADAY, 1) }));
      const { client } = fakeClient();
      for (let i = 0; i < 5; i++) {
        await getSectorDetail(deps(client, THU_INTRADAY, { detailBudget }), GROUP);
      }
      expect(detailBudget.tryTake(THU_INTRADAY.getTime())).toEqual({ ok: true });
    });
  });

  describe("getToday / getSectorBoard", () => {
    it("returns nulls and not stale on an empty database", async () => {
      expect(await getToday(db)).toEqual({ digest: null, board: null, stale: false });
      expect(await getSectorBoard(db)).toBeNull();
    });

    it("returns the stored digest and board", async () => {
      await saveSnapshot(db, row({ kind: "digest", parsed: DIGEST }));
      await saveSnapshot(db, row({}));
      const today = await getToday(db);
      expect(today.digest?.tradeDate).toBe("2026-10-08");
      expect(today.board?.sectors.length).toBeGreaterThan(0);
      expect(today.stale).toBe(false);
    });

    it("prefers the closed digest over a later non-closed row", async () => {
      await saveSnapshot(db, row({ kind: "digest", parsed: DIGEST }));
      await saveSnapshot(
        db,
        row({
          kind: "digest",
          session: "intraday",
          asOf: "10:30",
          capturedAt: new Date("2026-10-09T02:30:00Z"),
          parsed: { ...DIGEST, session: "intraday", tradeDate: "2026-10-09" },
        }),
      );
      const today = await getToday(db);
      expect(today.digest?.tradeDate).toBe("2026-10-08");
      expect(today.digest?.session).toBe("closed");
    });

    it("serves the freshest board even when it is intraday and newer than the digest", async () => {
      await saveSnapshot(db, row({ kind: "digest", parsed: DIGEST }));
      await saveSnapshot(db, row({}));
      await saveSnapshot(
        db,
        row({
          session: "intraday",
          asOf: "10:30",
          tradeDate: "2026-10-09",
          capturedAt: new Date("2026-10-09T02:30:00Z"),
          parsed: { ...BOARD, session: "intraday", tradeDate: "2026-10-09", asOf: "10:30" },
        }),
      );
      const today = await getToday(db);
      expect(today.board?.tradeDate).toBe("2026-10-09");
      expect(today.stale).toBe(false);
      expect((await getSectorBoard(db))?.asOf).toBe("10:30");
    });

    it("is stale when the board is older than the digest", async () => {
      await saveSnapshot(db, row({}));
      await saveSnapshot(
        db,
        row({
          kind: "digest",
          tradeDate: "2026-10-09",
          capturedAt: new Date("2026-10-09T07:00:00Z"),
          parsed: { ...DIGEST, tradeDate: "2026-10-09" },
        }),
      );
      const today = await getToday(db);
      expect(today.stale).toBe(true);
      expect(today.board?.tradeDate).toBe("2026-10-08");
    });

    it("skips rows whose parse failed", async () => {
      await saveSnapshot(db, row({ kind: "digest", parsed: DIGEST }));
      await saveSnapshot(
        db,
        row({
          kind: "digest",
          tradeDate: "2026-10-09",
          capturedAt: new Date("2026-10-09T07:00:00Z"),
          parsed: null,
          parseError: "boom",
        }),
      );
      expect((await getToday(db)).digest?.tradeDate).toBe("2026-10-08");
    });

    it("returns null for a stored shape that no longer matches the schema", async () => {
      await saveSnapshot(db, row({ kind: "digest", parsed: { ok: true } }));
      await saveSnapshot(db, row({ parsed: { sectors: "nope" } }));
      const today = await getToday(db);
      expect(today.digest).toBeNull();
      expect(today.board).toBeNull();
      expect(await getSectorBoard(db)).toBeNull();
    });
  });
});
