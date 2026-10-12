import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Db } from "../client";
import { marketSnapshots, type SnapshotSession } from "../schema";

export type Snapshot = typeof marketSnapshots.$inferSelect;
export type NewSnapshot = typeof marketSnapshots.$inferInsert;
export type SnapshotKind = Snapshot["kind"];

/**
 * Persists a snapshot unless one already exists for the same
 * `(kind, group_name, trade_date, as_of, session)` (NULL group_name/as_of compare equal to '').
 *
 * Contract: `rawHtml` must already be free of the upstream key. This repository does not scrub;
 * ingestion is responsible for that before calling.
 */
export async function saveSnapshot(db: Db, s: NewSnapshot): Promise<{ inserted: boolean }> {
  const rows = await db
    .insert(marketSnapshots)
    .values(s)
    .onConflictDoNothing()
    .returning({ id: marketSnapshots.id });
  return { inserted: rows.length > 0 };
}

/**
 * Moves `captured_at` of the already-stored row that `s` dedupes against (same key as
 * `saveSnapshot`). Used when upstream repeats an unchanged report, so "when did we last confirm
 * this" stays truthful without storing a duplicate.
 */
export async function touchSnapshot(db: Db, s: NewSnapshot): Promise<void> {
  await db
    .update(marketSnapshots)
    .set({ capturedAt: s.capturedAt })
    .where(
      and(
        eq(marketSnapshots.kind, s.kind),
        sql`coalesce(${marketSnapshots.groupName}, '') = ${s.groupName ?? ""}`,
        eq(marketSnapshots.tradeDate, s.tradeDate),
        sql`coalesce(${marketSnapshots.asOf}, '') = ${s.asOf ?? ""}`,
        eq(marketSnapshots.session, s.session),
      ),
    );
}

/**
 * Newest snapshot of a kind by `captured_at`; `parsedOnly` ignores rows whose parse failed and
 * `session` restricts to one session (e.g. the closed digest even if a later intraday row exists).
 */
export async function latestSnapshot(
  db: Db,
  kind: SnapshotKind,
  opts: { groupName?: string; parsedOnly?: boolean; session?: Snapshot["session"] } = {},
): Promise<Snapshot | null> {
  const conditions: SQL[] = [eq(marketSnapshots.kind, kind)];
  if (opts.groupName !== undefined) conditions.push(eq(marketSnapshots.groupName, opts.groupName));
  if (opts.parsedOnly) conditions.push(isNotNull(marketSnapshots.parsed));
  if (opts.session !== undefined) conditions.push(eq(marketSnapshots.session, opts.session));
  const [row] = await db
    .select()
    .from(marketSnapshots)
    .where(and(...conditions))
    .orderBy(desc(marketSnapshots.capturedAt))
    .limit(1);
  return row ?? null;
}

export async function hasSnapshot(
  db: Db,
  kind: SnapshotKind,
  tradeDate: string,
  opts: { session?: "closed" } = {},
): Promise<boolean> {
  const conditions: SQL[] = [
    eq(marketSnapshots.kind, kind),
    eq(marketSnapshots.tradeDate, tradeDate),
  ];
  if (opts.session) conditions.push(eq(marketSnapshots.session, opts.session));
  const rows = await db
    .select({ id: marketSnapshots.id })
    .from(marketSnapshots)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

/**
 * Closed-session snapshots in `[fromDate, toDate]`, one per trade date (latest `captured_at`
 * wins), ascending by trade date. With `parsedOnly` the latest is picked among rows that parsed,
 * so a later unparsed capture does not hide an earlier parsed one (dates with no parsed row drop out).
 */
export async function listClosedSnapshots(
  db: Db,
  kind: "digest" | "sector_board",
  fromDate: string,
  toDate: string,
  opts: { parsedOnly?: boolean } = {},
): Promise<Snapshot[]> {
  const conditions: SQL[] = [
    eq(marketSnapshots.kind, kind),
    eq(marketSnapshots.session, "closed"),
    gte(marketSnapshots.tradeDate, fromDate),
    lte(marketSnapshots.tradeDate, toDate),
  ];
  if (opts.parsedOnly) conditions.push(isNotNull(marketSnapshots.parsed));
  return db
    .selectDistinctOn([marketSnapshots.tradeDate])
    .from(marketSnapshots)
    .where(and(...conditions))
    .orderBy(marketSnapshots.tradeDate, desc(marketSnapshots.capturedAt));
}

/**
 * The greatest trade date among parsed closed-session snapshots of a kind (optionally only on or
 * before `onOrBefore`), or null. Unlike `latestSnapshot` this orders by trade date, so a backfill
 * captured later does not look like the newest day.
 */
export async function latestClosedTradeDate(
  db: Db,
  kind: "digest" | "sector_board",
  opts: { onOrBefore?: string } = {},
): Promise<string | null> {
  const conditions: SQL[] = [
    eq(marketSnapshots.kind, kind),
    eq(marketSnapshots.session, "closed"),
    isNotNull(marketSnapshots.parsed),
  ];
  if (opts.onOrBefore !== undefined) {
    conditions.push(lte(marketSnapshots.tradeDate, opts.onOrBefore));
  }
  const [row] = await db
    .select({ tradeDate: marketSnapshots.tradeDate })
    .from(marketSnapshots)
    .where(and(...conditions))
    .orderBy(desc(marketSnapshots.tradeDate))
    .limit(1);
  return row?.tradeDate ?? null;
}

/** The latest parsed closed-session snapshot of a kind for one trade date, or null. */
export async function getClosedSnapshot(
  db: Db,
  kind: "digest" | "sector_board",
  tradeDate: string,
): Promise<Snapshot | null> {
  const [row] = await listClosedSnapshots(db, kind, tradeDate, tradeDate, { parsedOnly: true });
  return row ?? null;
}

/**
 * Rows a re-parse could improve: parse never succeeded (`parsed IS NULL`) or produced by an older
 * parser, and not already attempted (failed or collided) at `currentParserVersion`, so permanently
 * failing rows cannot starve newer ones. Oldest trade date first, so a backlog drains in date order.
 */
export async function listReparseCandidates(
  db: Db,
  opts: { currentParserVersion: number; limit: number },
): Promise<Snapshot[]> {
  return db
    .select()
    .from(marketSnapshots)
    .where(
      and(
        or(
          isNull(marketSnapshots.parsed),
          lt(marketSnapshots.parserVersion, opts.currentParserVersion),
        ),
        // A re-parse that already failed or collided at this version cannot do better until the parser changes.
        sql`coalesce(${marketSnapshots.reparseAttemptedVersion}, 0) < ${opts.currentParserVersion}`,
      ),
    )
    .orderBy(
      asc(marketSnapshots.tradeDate),
      asc(marketSnapshots.capturedAt),
      asc(marketSnapshots.id),
    )
    .limit(opts.limit);
}

const UNIQUE_VIOLATION = "23505";

/** Drivers differ in where they put the Postgres code (on the error or on its `cause`), so walk the chain. */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth++) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Rewrites the parse outcome and the date key of one stored snapshot. `raw_html` and `captured_at`
 * are never written. When the new key already belongs to another row (the dedupe index) nothing
 * changes and `{ updated: false }` is returned; any other database error is rethrown.
 */
export async function updateSnapshotParse(
  db: Db,
  id: string,
  patch: {
    tradeDate: string;
    asOf: string | null;
    session: SnapshotSession;
    parsed: unknown;
    parseError: string | null;
    parserVersion: number;
  },
): Promise<{ updated: boolean }> {
  try {
    const rows = await db
      .update(marketSnapshots)
      .set(patch)
      .where(eq(marketSnapshots.id, id))
      .returning({ id: marketSnapshots.id });
    return { updated: rows.length > 0 };
  } catch (error) {
    if (isUniqueViolation(error)) return { updated: false };
    throw error;
  }
}

/**
 * Records that a re-parse at `version` did not improve the row, without touching its parse
 * columns or key. With `parseError` the new error message is stored too; after a failed re-parse of
 * an outdated row, `parse_error` may therefore coexist with a still-valid `parsed`.
 */
export async function markReparseAttempted(
  db: Db,
  id: string,
  version: number,
  parseError?: string,
): Promise<void> {
  await db
    .update(marketSnapshots)
    .set({
      reparseAttemptedVersion: version,
      ...(parseError !== undefined && { parseError }),
    })
    .where(eq(marketSnapshots.id, id));
}
