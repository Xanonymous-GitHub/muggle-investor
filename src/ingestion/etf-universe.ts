import type { Db } from "@/db/client";
import { listEtfUniverse, upsertEtfUniverse } from "@/db/repositories/etf-universe";
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
    const listings = await finmind.fetchStockInfo();
    if (listings.length === 0) {
      return { status: "failed", detail: "FinMind returned no listings; stored universe kept" };
    }
    await upsertEtfUniverse(db, listings, now);
    return { status: "done", detail: `${listings.length} listings` };
  } catch (error) {
    return { status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}
