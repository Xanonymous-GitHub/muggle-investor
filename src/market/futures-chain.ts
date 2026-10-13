const DAY_MS = 24 * 60 * 60 * 1000;
/** Futures prices are whole points; a gap beyond this between two closes is not rounding. */
const CHAIN_TOLERANCE = 0.5;

/** A trade date with its 台指期 close and day change, when the digest has futures data. */
export type FuturesDay = {
  tradeDate: string;
  futures: { close: number; change: number } | null;
};

/** The weekday that follows `date` (Friday → Monday), as a "YYYY-MM-DD" string. */
export function nextWeekday(date: string): string {
  const start = new Date(`${date}T00:00:00Z`);
  const weekday = start.getUTCDay();
  const skip = weekday === 5 ? 3 : weekday === 6 ? 2 : 1;
  return new Date(start.getTime() + skip * DAY_MS).toISOString().slice(0, 10);
}

/**
 * True when two consecutive futures days that are adjacent weekdays do not chain: the later
 * day's close minus its change should be the earlier day's close. A break means the contract
 * rolled over (or the data is inconsistent), so the days are not one comparable series. Days
 * that are not adjacent weekdays cannot be checked (a holiday or a missing digest sits between).
 * `days` must be sorted ascending by trade date.
 */
export function futuresChainBreaks(days: readonly FuturesDay[]): boolean {
  return days.some((day, i) => {
    const previous = days[i - 1];
    const today = day.futures;
    const before = previous?.futures;
    if (!previous || !today || !before) return false;
    if (nextWeekday(previous.tradeDate) !== day.tradeDate) return false;
    return Math.abs(today.close - today.change - before.close) > CHAIN_TOLERANCE;
  });
}
