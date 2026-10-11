import type { z } from "zod";
import type { Db } from "@/db/client";
import { getHolidays } from "@/db/repositories/calendar";
import { latestSnapshot, saveSnapshot } from "@/db/repositories/snapshots";
import { snapshotRow } from "@/ingestion/snapshot-row";
import { logger } from "@/lib/logger";
import { type MarketPhase, marketPhase, toTaipei } from "@/market-clock/market-clock";
import {
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

/** An intraday detail snapshot younger than this is served instead of asking upstream again. */
const INTRADAY_DETAIL_TTL_MS = 5 * 60 * 1000;
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
};

// One upstream call per group at a time: concurrent requests share it and the daily quota
// (10/min across the process) is not spent on duplicates.
const inFlight = new Map<string, Promise<SectorDetail>>();

/**
 * Constituents of one sector. Served from the stored snapshot when it is fresh enough, otherwise
 * fetched, stored and returned. `null` when the name is invalid or not on the latest board;
 * upstream is never asked about names the board does not list. Throws when upstream fails or
 * returns something unparsable (the raw body is still saved).
 */
export async function getSectorDetail(
  deps: SectorDetailDeps,
  group: string,
): Promise<SectorDetail | null> {
  if (!isValidGroupName(group)) return null;
  const { db, now } = deps;

  const board = await getSectorBoard(db);
  if (!board?.sectors.some((sector) => sector.name === group)) return null;

  // The 5-minute rule also covers "settling": data is still moving until the 14:00 close-out.
  const phase = marketPhase(now, deps.holidays);
  const live = phase === "intraday" || phase === "settling";
  const snapshot = await latestSnapshot(db, "sector_detail", {
    groupName: group,
    parsedOnly: true,
  });
  const cached = readParsed(sectorDetailSchema, snapshot);
  if (snapshot && cached) {
    const fresh = live
      ? now.getTime() - snapshot.capturedAt.getTime() < INTRADAY_DETAIL_TTL_MS
      : cached.tradeDate === board.tradeDate;
    if (fresh) return cached;
  }

  const pending = inFlight.get(group) ?? fetchAndStore(deps, group);
  inFlight.set(group, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(group) === pending) inFlight.delete(group);
  }
}

async function fetchAndStore(
  { db, darkfanxing, darkfanxingKey }: SectorDetailDeps,
  group: string,
): Promise<SectorDetail> {
  const scrub = (text: string) => redactKey(text, darkfanxingKey, "***");
  const fetched = await darkfanxing.fetchSectorDetail(group);
  const row = snapshotRow("sector_detail", group, fetched, scrub);
  await saveSnapshot(db, row);
  if (!fetched.parsed) {
    logger.error({ group, parseError: row.parseError }, "darkfanxing sector detail parse failed");
    throw new Error(`sector detail for "${group}" could not be parsed: ${row.parseError}`);
  }
  return fetched.parsed;
}
