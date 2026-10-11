import { and, asc, gte, lt, or, type SQL } from "drizzle-orm";
import type { MarketHoliday } from "@/sources/twse";
import type { Db } from "../client";
import { marketHolidays } from "../schema";

const inYear = (year: number): SQL | undefined =>
  and(gte(marketHolidays.date, `${year}-01-01`), lt(marketHolidays.date, `${year + 1}-01-01`));

/**
 * Atomically swaps the stored calendar of every year present in `holidays` (later duplicates
 * of a date win); other years are kept. Throws on an empty list so a partial or empty upstream
 * response can never wipe the calendar.
 */
export async function replaceHolidays(db: Db, holidays: MarketHoliday[]): Promise<void> {
  if (holidays.length === 0) throw new Error("replaceHolidays: refusing an empty holiday list");
  const byDate = new Map(holidays.map((h) => [h.date, h]));
  const years = [...new Set(holidays.map((h) => Number(h.date.slice(0, 4))))];
  await db.transaction(async (tx) => {
    await tx.delete(marketHolidays).where(or(...years.map(inYear)));
    await tx.insert(marketHolidays).values([...byDate.values()]);
  });
}

export async function getHolidays(db: Db, year: number): Promise<MarketHoliday[]> {
  return db.select().from(marketHolidays).where(inYear(year)).orderBy(asc(marketHolidays.date));
}
