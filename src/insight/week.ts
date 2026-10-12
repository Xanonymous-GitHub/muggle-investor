import { isTradingDay } from "@/market-clock/market-clock";
import type { MarketHoliday } from "@/sources/twse";

/**
 * ISO 8601 weeks (Monday to Sunday; a week belongs to the year that holds its Thursday) on
 * "YYYY-MM-DD" strings. Dates are handled as day numbers since 1970-01-01 via `Date.UTC`, so the
 * results never depend on the local time zone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;

/** Days since 1970-01-01 (a Thursday) for a valid "YYYY-MM-DD" date; throws otherwise. */
function dayNumber(date: string): number {
  const match = DATE.exec(date);
  const [, year, month, day] = match ?? [];
  const days = Date.UTC(Number(year), Number(month) - 1, Number(day)) / DAY_MS;
  if (!match || !Number.isInteger(days) || toDate(days) !== date) {
    throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  }
  return days;
}

function toDate(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. Day 0 (1970-01-01) is a Thursday. */
const isoWeekday = (days: number): number => ((((days + 3) % 7) + 7) % 7) + 1;

/** ISO year and week of a day number. */
function isoWeek(days: number): { year: number; week: number } {
  const thursday = days + 4 - isoWeekday(days);
  const year = Number(toDate(thursday).slice(0, 4));
  const jan1 = Date.UTC(year, 0, 1) / DAY_MS;
  return { year, week: Math.floor((thursday - jan1) / 7) + 1 };
}

const weekKeyOf = ({ year, week }: { year: number; week: number }): string =>
  `${year}-W${String(week).padStart(2, "0")}`;

/** "2026-10-08" → "2026-W41". Throws on anything but a valid "YYYY-MM-DD" date. */
export function isoWeekKey(date: string): string {
  return weekKeyOf(isoWeek(dayNumber(date)));
}

/** Day number of the Monday of `weekKey`; throws unless it is a real "YYYY-Www" ISO week. */
function mondayOf(weekKey: string): number {
  const match = WEEK_KEY.exec(weekKey);
  const [, year, week] = match ?? [];
  // January 4th is always in week 1.
  const jan4 = Date.UTC(Number(year), 0, 4) / DAY_MS;
  const monday = jan4 - (isoWeekday(jan4) - 1) + (Number(week) - 1) * 7;
  if (!match || weekKeyOf(isoWeek(monday)) !== weekKey) {
    throw new Error(`Invalid ISO week "${weekKey}", expected an existing YYYY-Www week`);
  }
  return monday;
}

/** Monday and Sunday of `weekKey`: "2026-W41" → { from: "2026-10-05", to: "2026-10-11" }. */
export function weekRange(weekKey: string): { from: string; to: string } {
  const monday = mondayOf(weekKey);
  return { from: toDate(monday), to: toDate(monday + 6) };
}

/**
 * True when `latestClosedDate` lies within `weekKey` and no trading day of that week (per
 * `isTradingDay`, so a weekend makeup trading day counts) comes after it. False when nothing has
 * closed yet or the latest close is in another week.
 */
export function isWeekComplete(
  weekKey: string,
  holidays: MarketHoliday[],
  latestClosedDate: string | null,
): boolean {
  const monday = mondayOf(weekKey);
  if (latestClosedDate === null || isoWeekKey(latestClosedDate) !== weekKey) return false;
  for (let day = dayNumber(latestClosedDate) + 1; day <= monday + 6; day++) {
    if (isTradingDay(toDate(day), holidays)) return false;
  }
  return true;
}
