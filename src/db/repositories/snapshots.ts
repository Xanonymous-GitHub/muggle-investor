import { and, desc, eq, gte, isNotNull, lte, type SQL, sql } from "drizzle-orm";
import type { Db } from "../client";
import { marketSnapshots } from "../schema";

export type Snapshot = typeof marketSnapshots.$inferSelect;
export type NewSnapshot = typeof marketSnapshots.$inferInsert;
export type SnapshotKind = Snapshot["kind"];

/**
 * Persists a snapshot unless one already exists for the same
 * `(kind, group_name, trade_date, as_of)` (NULLs compare equal to '').
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
 * wins), ascending by trade date.
 */
export async function listClosedSnapshots(
  db: Db,
  kind: "digest" | "sector_board",
  fromDate: string,
  toDate: string,
): Promise<Snapshot[]> {
  return db
    .selectDistinctOn([marketSnapshots.tradeDate])
    .from(marketSnapshots)
    .where(
      and(
        eq(marketSnapshots.kind, kind),
        eq(marketSnapshots.session, "closed"),
        gte(marketSnapshots.tradeDate, fromDate),
        lte(marketSnapshots.tradeDate, toDate),
      ),
    )
    .orderBy(marketSnapshots.tradeDate, desc(marketSnapshots.capturedAt));
}
