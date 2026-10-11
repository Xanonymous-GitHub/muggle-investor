import { and, asc, eq, gte, lte, max, sql } from "drizzle-orm";
import type { CorporateAction, PriceBar } from "@/sources/finmind";
import type { Db } from "../client";
import { corporateActions, priceBars } from "../schema";

/** Keeps multi-row inserts well under Postgres' 65535 bind-parameter limit. */
const BATCH_SIZE = 1000;

function chunk<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) out.push(items.slice(i, i + BATCH_SIZE));
  return out;
}

export async function upsertPriceBars(db: Db, bars: PriceBar[]): Promise<void> {
  for (const batch of chunk(bars)) {
    await db
      .insert(priceBars)
      .values(batch)
      .onConflictDoUpdate({
        target: [priceBars.symbol, priceBars.date],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
        },
      });
  }
}

export async function upsertCorporateActions(db: Db, actions: CorporateAction[]): Promise<void> {
  for (const batch of chunk(actions)) {
    await db
      .insert(corporateActions)
      .values(batch)
      .onConflictDoUpdate({
        target: [corporateActions.symbol, corporateActions.exDate, corporateActions.kind],
        set: {
          beforePrice: sql`excluded.before_price`,
          afterPrice: sql`excluded.after_price`,
          cashDividend: sql`excluded.cash_dividend`,
        },
      });
  }
}

export async function latestPriceDate(db: Db, symbol: string): Promise<string | null> {
  const [row] = await db
    .select({ latest: max(priceBars.date) })
    .from(priceBars)
    .where(eq(priceBars.symbol, symbol));
  return row?.latest ?? null;
}

/** Bars in `[start, end]` (inclusive), ascending by date. */
export async function getPriceBars(
  db: Db,
  symbol: string,
  start: string,
  end: string,
): Promise<PriceBar[]> {
  return db
    .select()
    .from(priceBars)
    .where(and(eq(priceBars.symbol, symbol), gte(priceBars.date, start), lte(priceBars.date, end)))
    .orderBy(asc(priceBars.date));
}

/** All stored corporate actions for a symbol, ascending by ex-date. */
export async function getCorporateActions(db: Db, symbol: string): Promise<CorporateAction[]> {
  return db
    .select()
    .from(corporateActions)
    .where(eq(corporateActions.symbol, symbol))
    .orderBy(asc(corporateActions.exDate), asc(corporateActions.kind));
}
