import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { RateLimiter } from "@/lib/rate-limiter";
import { createTwseClient, type MarketHoliday } from "@/sources/twse";
import { isoWeekKey, isWeekComplete, weekRange } from "./week";

const fixture = readFileSync("test/fixtures/twse/holiday-schedule.json", "utf8");

let holidays: MarketHoliday[];

beforeAll(async () => {
  const limiter: RateLimiter = { acquire: async () => {}, tryAcquire: () => true };
  const fetchImpl = (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch;
  holidays = await createTwseClient({ limiter, fetchImpl }).fetchHolidaySchedule();
});

describe("isoWeekKey", () => {
  // Expected values follow the ISO 8601 rule (a week belongs to the year of its Thursday) and
  // were cross-checked with BSD `date +%G-W%V`. 2026 starts on a Thursday, so it has 53 weeks.
  it.each([
    ["2026-10-08", "2026-W41"],
    ["2026-10-05", "2026-W41"],
    ["2026-10-11", "2026-W41"],
    ["2026-10-12", "2026-W42"],
    ["2026-01-01", "2026-W01"],
    ["2025-12-29", "2026-W01"],
    ["2025-12-28", "2025-W52"],
    ["2026-12-31", "2026-W53"],
    ["2027-01-03", "2026-W53"],
    ["2027-01-04", "2027-W01"],
    ["2024-12-30", "2025-W01"],
    // 2020 is a leap year starting on a Wednesday, so it also has 53 weeks.
    ["2020-12-31", "2020-W53"],
  ])("puts %s in %s", (date, week) => {
    expect(isoWeekKey(date)).toBe(week);
  });

  it.each(["2026-13-01", "2026-02-30", "2026-1-5", "20261005", ""])("rejects %j", (date) => {
    expect(() => isoWeekKey(date)).toThrow(/date/i);
  });
});

describe("weekRange", () => {
  it("spans Monday to Sunday", () => {
    expect(weekRange("2026-W41")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("crosses year boundaries in both directions", () => {
    expect(weekRange("2026-W01")).toEqual({ from: "2025-12-29", to: "2026-01-04" });
    expect(weekRange("2026-W53")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("round-trips with isoWeekKey", () => {
    for (const week of ["2026-W01", "2026-W41", "2026-W53", "2027-W01", "2020-W53"]) {
      const { from, to } = weekRange(week);
      expect(isoWeekKey(from)).toBe(week);
      expect(isoWeekKey(to)).toBe(week);
    }
  });

  it.each(["2026-W00", "2026-W54", "2025-W53", "2026-41", "2026-W5"])("rejects %j", (week) => {
    expect(() => weekRange(week)).toThrow(/week/i);
  });
});

describe("isWeekComplete", () => {
  it("is false while Friday is still an upcoming trading day", () => {
    expect(isWeekComplete("2026-W41", [], "2026-10-08")).toBe(false);
  });

  it("is true after Thursday when Friday is a holiday (2026-10-09 國慶補假)", () => {
    expect(isWeekComplete("2026-W41", holidays, "2026-10-08")).toBe(true);
  });

  it("is true once Friday has closed in a week without holidays", () => {
    expect(isWeekComplete("2026-W41", [], "2026-10-09")).toBe(true);
  });

  it("counts a weekend makeup trading day as part of the week", () => {
    const makeup: MarketHoliday[] = [{ date: "2026-10-10", name: "補行交易", isTradingDay: true }];
    expect(isWeekComplete("2026-W41", makeup, "2026-10-09")).toBe(false);
    expect(isWeekComplete("2026-W41", makeup, "2026-10-10")).toBe(true);
  });

  it("is false when nothing has closed or the latest close is in another week", () => {
    expect(isWeekComplete("2026-W41", holidays, null)).toBe(false);
    expect(isWeekComplete("2026-W41", holidays, "2026-10-02")).toBe(false);
    expect(isWeekComplete("2026-W41", holidays, "2026-10-12")).toBe(false);
  });
});
