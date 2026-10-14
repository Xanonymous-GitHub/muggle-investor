import { asc, eq, sql } from "drizzle-orm";
import type { StockInfo } from "@/sources/finmind";
import type { Db } from "../client";
import { etfUniverse } from "../schema";

export type EtfUniverseRow = typeof etfUniverse.$inferSelect;

/** Inserts or refreshes the ETFs among `items` (industry contains "ETF"); never clears `history_checked_at`. */
export async function upsertEtfUniverse(db: Db, items: StockInfo[]): Promise<void> {
  const etfs = items.filter((item) => item.industry.includes("ETF"));
  if (etfs.length === 0) return;
  await db
    .insert(etfUniverse)
    .values(etfs)
    .onConflictDoUpdate({
      target: etfUniverse.symbol,
      set: {
        name: sql`excluded.name`,
        market: sql`excluded.market`,
        industry: sql`excluded.industry`,
        updatedAt: sql`now()`,
      },
    });
}

export async function listEtfUniverse(db: Db): Promise<EtfUniverseRow[]> {
  return db.select().from(etfUniverse).orderBy(asc(etfUniverse.symbol));
}

export async function markHistoryChecked(db: Db, symbol: string, at: Date): Promise<void> {
  await db.update(etfUniverse).set({ historyCheckedAt: at }).where(eq(etfUniverse.symbol, symbol));
}
