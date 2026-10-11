import { z } from "zod";

export type MarketHoliday = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  name: string;
  /** True for entries that mark the market as open, e.g. 國曆新年開始交易日; false for closures and settlement-only days. */
  isTradingDay: boolean;
};

/** One row of the TWSE holidaySchedule feed; `Date` is a compact ROC date such as "1150101". */
export const holidayRowSchema = z.object({
  Name: z.string(),
  Date: z.string().regex(/^\d{7}$/),
});

export const holidayScheduleSchema = z.array(holidayRowSchema);
