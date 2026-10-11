import { and, asc, gte, lt } from "drizzle-orm";
import type { MarketHoliday } from "@/sources/twse";
import type { Db } from "../client";
import { marketHolidays } from "../schema";

/** Atomically swaps the stored calendar for `holidays` (later duplicates of a date win). */
export async function replaceHolidays(db: Db, holidays: MarketHoliday[]): Promise<void> {
  const byDate = new Map(holidays.map((h) => [h.date, h]));
  await db.transaction(async (tx) => {
    await tx.delete(marketHolidays);
    if (byDate.size > 0) await tx.insert(marketHolidays).values([...byDate.values()]);
  });
}

export async function getHolidays(db: Db, year: number): Promise<MarketHoliday[]> {
  return db
    .select()
    .from(marketHolidays)
    .where(
      and(gte(marketHolidays.date, `${year}-01-01`), lt(marketHolidays.date, `${year + 1}-01-01`)),
    )
    .orderBy(asc(marketHolidays.date));
}
