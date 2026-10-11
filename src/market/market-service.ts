import type { z } from "zod";
import type { Db } from "@/db/client";
import { getHolidays } from "@/db/repositories/calendar";
import { latestSnapshot, saveSnapshot, touchSnapshot } from "@/db/repositories/snapshots";
import { snapshotRow } from "@/ingestion/snapshot-row";
import { logger } from "@/lib/logger";
import { LimiterBusyError } from "@/lib/rate-limiter";
import {
  type MarketPhase,
  marketPhase,
  settlementInstant,
  toTaipei,
} from "@/market-clock/market-clock";
import {
  DARKFANXING_WINDOW_MS,
  type DarkfanxingClient,
  type DigestSnapshot,
  redactKey,
  type SectorBoard,
  type SectorDetail,
} from "@/sources/darkfanxing";
import {
  digestSnapshotSchema,
  sectorBoardSchema,
  sectorDetailSchema,
} from "@/sources/darkfanxing/schemas";
import type { MarketHoliday } from "@/sources/twse";
import { createOnDemandBudget, type OnDemandBudget } from "./on-demand-budget";

/** An intraday detail snapshot younger than this is served instead of asking upstream again. */
const INTRADAY_DETAIL_TTL_MS = 5 * 60 * 1000;
/**
 * Upstream detail fetches a user request may trigger per rolling window, per process. The
 * darkfanxing quota (10/min) is shared with ingestion, which needs 1-2 calls per run; keeping
 * on-demand traffic to 3/min leaves it room.
 */
const DETAIL_FETCHES_PER_WINDOW = 3;
const DETAIL_BUDGET_WINDOW_MS = 60 * 1000;
const defaultDetailBudget = createOnDemandBudget({
  limit: DETAIL_FETCHES_PER_WINDOW,
  windowMs: DETAIL_BUDGET_WINDOW_MS,
});
const MAX_GROUP_NAME_LENGTH = 64;
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Group names are user input that ends up in an upstream URL and a database key: bounded and
 * free of control characters. Whether the name exists is decided by the stored board.
 */
export function isValidGroupName(group: string): boolean {
  return (
    group.length > 0 && group.length <= MAX_GROUP_NAME_LENGTH && !CONTROL_CHARACTERS.test(group)
  );
}

/**
 * Re-validates a stored `parsed` value (the schema may have evolved since it was written);
 * a mismatch is logged and treated as missing.
 */
function readParsed<S extends z.ZodType>(
  schema: S,
  snapshot: { kind: string; tradeDate: string; parsed: unknown } | null,
): z.infer<S> | null {
  if (!snapshot) return null;
  const result = schema.safeParse(snapshot.parsed);
  if (result.success) return result.data;
  logger.error(
    { kind: snapshot.kind, tradeDate: snapshot.tradeDate, issues: result.error.issues.length },
    "stored snapshot no longer matches its schema",
  );
  return null;
}

/** The freshest board overall: intraday boards are the point of this view. */
export async function getSectorBoard(db: Db): Promise<SectorBoard | null> {
  return readParsed(
    sectorBoardSchema,
    await latestSnapshot(db, "sector_board", { parsedOnly: true }),
  );
}

/**
 * The latest closed digest and the freshest board. `stale` means the board is from an earlier
 * trade date than the digest (e.g. the board ingestion lags behind).
 */
export async function getToday(
  db: Db,
): Promise<{ digest: DigestSnapshot | null; board: SectorBoard | null; stale: boolean }> {
  const digest = readParsed(
    digestSnapshotSchema,
    await latestSnapshot(db, "digest", { parsedOnly: true, session: "closed" }),
  );
  const board = await getSectorBoard(db);
  return { digest, board, stale: !!digest && !!board && board.tradeDate < digest.tradeDate };
}

/** The market phase right now, from the stored trading calendar. */
export async function currentPhase(db: Db, now: Date): Promise<MarketPhase> {
  const year = Number(toTaipei(now).date.slice(0, 4));
  return marketPhase(now, await getHolidays(db, year));
}

export type SectorDetailDeps = {
  db: Db;
  darkfanxing: DarkfanxingClient;
  /** Scrubbed from the stored raw body; never persisted or returned. */
  darkfanxingKey: string;
  now: Date;
  holidays: MarketHoliday[];
  /** Cap on user-triggered upstream fetches; defaults to a process-wide budget. */
  detailBudget?: OnDemandBudget;
};

/**
 * Nothing is stored and no upstream call may be made now (on-demand budget spent, or the shared
 * darkfanxing limiter has no free token); retry after the hint.
 */
export class SectorDetailBusyError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`sector detail temporarily unavailable, retry in ${retryAfterSeconds}s`);
    this.name = "SectorDetailBusyError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// One lookup per group at a time: concurrent requests share its result and the per-minute
// upstream quota (10/min across the process) is not spent on duplicates.
const inFlight = new Map<string, Promise<SectorDetail>>();

/**
 * Constituents of one sector. Served from the stored snapshot when it is fresh enough, otherwise
 * fetched, stored and returned. `null` when the name is invalid or not on the latest board;
 * upstream is never asked about names the board does not list.
 *
 * The upstream fetch never waits on the shared darkfanxing limiter. When a fetch is needed but
 * cannot happen (on-demand budget spent, or no shared-limiter token free right now) or fails
 * (HTTP error, unparsable body; the raw body is still saved), a stored detail is served stale
 * (the caller sees its `asOf`). With nothing stored, it throws `SectorDetailBusyError` for the
 * first two cases and rethrows the failure otherwise.
 */
export async function getSectorDetail(
  deps: SectorDetailDeps,
  group: string,
): Promise<SectorDetail | null> {
  if (!isValidGroupName(group)) return null;

  const board = await getSectorBoard(deps.db);
  if (!board?.sectors.some((sector) => sector.name === group)) return null;

  const pending = inFlight.get(group) ?? resolveDetail(deps, group, board);
  inFlight.set(group, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(group) === pending) inFlight.delete(group);
  }
}

async function resolveDetail(
  deps: SectorDetailDeps,
  group: string,
  board: SectorBoard,
): Promise<SectorDetail> {
  const { db, now } = deps;
  const snapshot = await latestSnapshot(db, "sector_detail", {
    groupName: group,
    parsedOnly: true,
  });
  const cached = readParsed(sectorDetailSchema, snapshot);
  if (snapshot && cached && isFresh(snapshot.capturedAt, cached, board, deps)) return cached;

  const decision = (deps.detailBudget ?? defaultDetailBudget).tryTake(now.getTime());
  if (!decision.ok) {
    if (cached) return cached;
    throw new SectorDetailBusyError(Math.ceil(decision.retryAfterMs / 1000));
  }
  try {
    return await fetchAndStore(deps, group);
  } catch (error) {
    if (error instanceof LimiterBusyError) {
      if (cached) return cached;
      // The shared window refills within its length; a finer hint would need limiter internals.
      throw new SectorDetailBusyError(Math.ceil(DARKFANXING_WINDOW_MS / 1000));
    }
    if (!cached) throw error;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    logger.warn(
      { group, error: redactKey(message, deps.darkfanxingKey, "***") },
      "sector detail refresh failed; serving the stored detail",
    );
    return cached;
  }
}

/**
 * While the market is moving (intraday, and settling until the 14:00 close-out) a detail is
 * reusable for 5 minutes. Otherwise it must be for the board's trade date and captured after that
 * day's 13:35 settlement, never an intraday capture.
 */
function isFresh(
  capturedAt: Date,
  detail: SectorDetail,
  board: SectorBoard,
  { now, holidays }: SectorDetailDeps,
): boolean {
  const phase = marketPhase(now, holidays);
  if (phase === "intraday" || phase === "settling") {
    return now.getTime() - capturedAt.getTime() < INTRADAY_DETAIL_TTL_MS;
  }
  return (
    detail.tradeDate === board.tradeDate &&
    capturedAt.getTime() >= settlementInstant(detail.tradeDate).getTime()
  );
}

async function fetchAndStore(
  { db, darkfanxing, darkfanxingKey }: SectorDetailDeps,
  group: string,
): Promise<SectorDetail> {
  const scrub = (text: string) => redactKey(text, darkfanxingKey, "***");
  // User-triggered: never queue behind ingestion on the shared limiter.
  const fetched = await darkfanxing.fetchSectorDetail(group, { nonBlocking: true });
  const row = snapshotRow("sector_detail", group, fetched, scrub);
  const { inserted } = await saveSnapshot(db, row);
  // Upstream repeated a report we already hold: record that it was just confirmed.
  if (!inserted) await touchSnapshot(db, row);
  if (!fetched.parsed) {
    logger.error({ group, parseError: row.parseError }, "darkfanxing sector detail parse failed");
    throw new Error(`sector detail for "${group}" could not be parsed: ${row.parseError}`);
  }
  return fetched.parsed;
}
