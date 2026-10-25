// How current a stored observation is against the Taipei trading calendar. Pure: the caller
// supplies the holidays. A weekend or a holiday does not make the last trading session stale; data
// is "behind" only when a session that has settled since is missing.
import { isTradingDay, lastSettledTradeDate, marketPhase } from "@/market-clock/market-clock";
import type { MarketHoliday } from "@/sources/twse";

export type ObservationSession = "closed" | "intraday" | "unknown" | "series";

/**
 * `current`: it is from the latest settled session (or a closed series reaching it).
 * `provisional`: an intraday snapshot, not a final close, however recent.
 * `behind`: a settled session after it is missing (`tradingDaysBehind` says how many).
 * `unknown`: the observation does not say which session it is from.
 */
export type FreshnessState = "current" | "provisional" | "behind" | "unknown";

export type Freshness = {
  state: FreshnessState;
  /** The latest trade date that has settled at `now`; the date a closed observation should reach. */
  expectedDate: string;
  /** Trading days between the observation and `expectedDate`; 0 unless `behind`. */
  tradingDaysBehind: number;
  /** The market is trading or settling at `now`. */
  marketOpenNow: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_COUNT_DAYS = 60;

function nextDate(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);
}

/** Trading days in `(after, through]`, at most MAX_COUNT_DAYS counted. */
function tradingDaysBetween(after: string, through: string, holidays: MarketHoliday[]): number {
  let count = 0;
  let day = after;
  for (let i = 0; i < MAX_COUNT_DAYS && day < through; i++) {
    day = nextDate(day);
    if (isTradingDay(day, holidays)) count += 1;
  }
  return count;
}

export function assessFreshness(input: {
  dataDate: string;
  session: ObservationSession;
  now: Date;
  holidays: MarketHoliday[];
}): Freshness {
  const { dataDate, session, now, holidays } = input;
  const expectedDate = lastSettledTradeDate(now, holidays);
  const phase = marketPhase(now, holidays);
  const marketOpenNow = phase === "intraday" || phase === "settling";
  const behindBy =
    dataDate < expectedDate ? tradingDaysBetween(dataDate, expectedDate, holidays) : 0;
  const base = { expectedDate, marketOpenNow };

  if (behindBy > 0) return { ...base, state: "behind", tradingDaysBehind: behindBy };
  // An intraday snapshot is a moment of a session, never its close, even once the day is over.
  if (session === "intraday") return { ...base, state: "provisional", tradingDaysBehind: 0 };
  if (session === "unknown") return { ...base, state: "unknown", tradingDaysBehind: 0 };
  return { ...base, state: "current", tradingDaysBehind: 0 };
}
