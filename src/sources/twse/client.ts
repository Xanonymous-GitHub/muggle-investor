import { fetchWithRetry } from "@/lib/http";
import type { RateLimiter, Sleep } from "@/lib/rate-limiter";
import { parseRocDate } from "../shared/parse-values";
import { holidayScheduleSchema, type MarketHoliday } from "./schemas";

export interface TwseClient {
  fetchHolidaySchedule(): Promise<MarketHoliday[]>;
}

export type TwseClientOptions = {
  limiter: RateLimiter;
  fetchImpl?: typeof fetch;
  /** Backoff sleep between retries; injectable for tests. */
  sleep?: Sleep;
};

const HOLIDAY_URL = "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule";

/** Names that mark the market as open: first trading day of the year, last before a break. */
const TRADING_DAY_NAME = /開始交易|最後交易/;

export function createTwseClient({ limiter, fetchImpl, sleep }: TwseClientOptions): TwseClient {
  return {
    async fetchHolidaySchedule() {
      await limiter.acquire();
      const response = await fetchWithRetry(HOLIDAY_URL, {
        ...(fetchImpl && { fetchImpl }),
        ...(sleep && { sleep }),
      });
      const parsed = holidayScheduleSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error(
          `TWSE holiday schedule: unexpected response shape (${parsed.error.message})`,
        );
      }
      return parsed.data.map((row) => ({
        date: parseRocDate(row.Date),
        name: row.Name,
        isTradingDay: TRADING_DAY_NAME.test(row.Name),
      }));
    },
  };
}
