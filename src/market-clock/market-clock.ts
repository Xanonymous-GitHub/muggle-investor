import type { MarketHoliday } from "@/sources/twse";

const MARKET_TIME_ZONE = "Asia/Taipei";
const OPEN_MINUTES = 9 * 60;
const SETTLING_START_MINUTES = 13 * 60 + 35;
const POST_CLOSE_MINUTES = 14 * 60;
const MAX_LOOKBACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MarketPhase = "closed-day" | "pre-open" | "intraday" | "settling" | "post-close";

const taipeiFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The wall-clock reading in Taipei: ISO date, minutes since midnight, weekday (0 = Sunday). */
export function toTaipei(now: Date): { date: string; minutes: number; weekday: number } {
  const parts: Record<string, string> = {};
  for (const { type, value } of taipeiFormat.formatToParts(now)) parts[type] = value;
  const weekday = WEEKDAY_INDEX[parts.weekday ?? ""];
  if (weekday === undefined) throw new Error(`Unexpected Taipei weekday "${parts.weekday}"`);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday,
  };
}

/** Weekend dates are closed unless a holiday row marks a makeup trading day; a row always wins. */
export function isTradingDay(date: string, holidays: MarketHoliday[]): boolean {
  const row = holidays.find((holiday) => holiday.date === date);
  if (row) return row.isTradingDay;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function marketPhase(now: Date, holidays: MarketHoliday[]): MarketPhase {
  const { date, minutes } = toTaipei(now);
  if (!isTradingDay(date, holidays)) return "closed-day";
  if (minutes < OPEN_MINUTES) return "pre-open";
  if (minutes < SETTLING_START_MINUTES) return "intraday";
  if (minutes < POST_CLOSE_MINUTES) return "settling";
  return "post-close";
}

function previousDate(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - DAY_MS).toISOString().slice(0, 10);
}

/** Most recent trade date whose data has settled: today once post-close, else the prior trading day. */
export function lastSettledTradeDate(now: Date, holidays: MarketHoliday[]): string {
  const today = toTaipei(now).date;
  if (marketPhase(now, holidays) === "post-close") return today;
  let candidate = today;
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    candidate = previousDate(candidate);
    if (isTradingDay(candidate, holidays)) return candidate;
  }
  throw new Error(`No trading day found within ${MAX_LOOKBACK_DAYS} days before ${today}`);
}
