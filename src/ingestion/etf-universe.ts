import type { Db } from "@/db/client";
import { etfListings, listEtfUniverse, upsertEtfUniverse } from "@/db/repositories/etf-universe";
import type { FinMindClient } from "@/sources/finmind";
import type { Outcome } from "./run-ingestion";

/** The listing changes rarely; one TaiwanStockInfo request a week keeps it current. */
const REFRESH_INTERVAL_MS = 7 * 86_400_000;

/**
 * Refreshes `etf_universe` from FinMind's listing unless the newest row is younger than 7 days.
 * Never throws: a FinMind or database error becomes a `failed` outcome and the stored rows stay.
 */
export async function refreshEtfUniverse(deps: {
  db: Db;
  finmind: FinMindClient;
  now: Date;
}): Promise<Outcome> {
  const { db, finmind, now } = deps;
  try {
    const rows = await listEtfUniverse(db);
    const newest = Math.max(...rows.map((row) => row.updatedAt.getTime()));
    if (rows.length > 0 && now.getTime() - newest < REFRESH_INTERVAL_MS) {
      return {
        status: "skipped",
        detail: `refreshed ${new Date(newest).toISOString()}, under 7 days ago`,
      };
    }
    // Counting ETFs, not listings: with none stored, updated_at would not move and a "done"
    // would hide that every run refetches; "failed" makes it visible and it is retried.
    const etfs = etfListings(await finmind.fetchStockInfo());
    if (etfs.length === 0) return { status: "failed", detail: "no ETF rows" };
    await upsertEtfUniverse(db, etfs, now);
    return { status: "done", detail: `${etfs.length} ETFs` };
  } catch (error) {
    return { status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}
