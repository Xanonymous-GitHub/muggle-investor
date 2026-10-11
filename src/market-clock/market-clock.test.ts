import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { RateLimiter } from "@/lib/rate-limiter";
import { createTwseClient, type MarketHoliday } from "@/sources/twse";
import {
  isTradingDay,
  lastSettledTradeDate,
  marketPhase,
  settlementInstant,
  toTaipei,
} from "./market-clock";

const fixture = readFileSync("test/fixtures/twse/holiday-schedule.json", "utf8");

let holidays: MarketHoliday[];

beforeAll(async () => {
  const limiter: RateLimiter = { acquire: async () => {} };
  const fetchImpl = (async () => new Response(fixture, { status: 200 })) as unknown as typeof fetch;
  holidays = await createTwseClient({ limiter, fetchImpl }).fetchHolidaySchedule();
});

describe("toTaipei", () => {
  it("shifts UTC into Taipei date, minutes since midnight and weekday", () => {
    expect(toTaipei(new Date("2026-10-08T01:00:00Z"))).toEqual({
      date: "2026-10-08",
      minutes: 9 * 60,
      weekday: 4,
    });
  });

  it("rolls the date over at Taipei midnight, not UTC midnight", () => {
    expect(toTaipei(new Date("2026-10-10T16:30:00Z"))).toEqual({
      date: "2026-10-11",
      minutes: 30,
      weekday: 0,
    });
  });
});

describe("isTradingDay", () => {
  it("is false on weekends", () => {
    expect(isTradingDay("2026-10-10", holidays)).toBe(false);
    expect(isTradingDay("2026-10-11", holidays)).toBe(false);
  });

  it("is false on a weekday holiday and true on a normal weekday", () => {
    expect(isTradingDay("2026-01-01", holidays)).toBe(false);
    expect(isTradingDay("2026-10-09", holidays)).toBe(false);
    expect(isTradingDay("2026-10-08", holidays)).toBe(true);
  });

  it("is true on the first trading day of the year", () => {
    expect(isTradingDay("2026-01-02", holidays)).toBe(true);
  });

  it("is true on a weekend makeup trading day", () => {
    const makeup: MarketHoliday[] = [{ date: "2026-10-10", name: "補行交易", isTradingDay: true }];
    expect(isTradingDay("2026-10-10", makeup)).toBe(true);
  });
});

describe("marketPhase", () => {
  const at = (iso: string) => marketPhase(new Date(iso), holidays);

  it("is closed-day on a weekend and on a holiday", () => {
    expect(at("2026-10-11T03:00:00Z")).toBe("closed-day");
    expect(at("2026-01-01T03:00:00Z")).toBe("closed-day");
  });

  it("is pre-open before 09:00 Taipei", () => {
    expect(at("2026-10-08T00:59:00Z")).toBe("pre-open");
  });

  it("is intraday from 09:00 through 13:34", () => {
    expect(at("2026-10-08T01:00:00Z")).toBe("intraday");
    expect(at("2026-10-08T05:34:00Z")).toBe("intraday");
  });

  it("is settling from 13:35 through 13:59", () => {
    expect(at("2026-10-08T05:35:00Z")).toBe("settling");
    expect(at("2026-10-08T05:59:00Z")).toBe("settling");
  });

  it("is post-close from 14:00", () => {
    expect(at("2026-10-08T06:00:00Z")).toBe("post-close");
  });
});

describe("lastSettledTradeDate", () => {
  const settled = (iso: string, list: MarketHoliday[] = holidays) =>
    lastSettledTradeDate(new Date(iso), list);

  it("skips a weekend and a holiday on a Sunday", () => {
    expect(settled("2026-10-11T03:00:00Z")).toBe("2026-10-08");
  });

  it("is today once the day is post-close", () => {
    expect(settled("2026-10-08T06:00:00Z")).toBe("2026-10-08");
  });

  it("is the previous trading day while today is still intraday", () => {
    expect(settled("2026-10-08T03:00:00Z")).toBe("2026-10-07");
  });

  it("walks back across a year boundary and holiday before pre-open", () => {
    expect(settled("2026-01-02T00:00:00Z")).toBe("2025-12-31");
  });

  it("throws when no trading day exists within 30 days", () => {
    const closedAlways: MarketHoliday[] = Array.from({ length: 45 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 11 - i)).toISOString().slice(0, 10),
      name: "closed",
      isTradingDay: false,
    }));
    expect(() => settled("2026-10-11T03:00:00Z", closedAlways)).toThrow(/trading day/i);
  });
});

describe("settlementInstant", () => {
  it("is 13:35 Taipei on the trade date, the moment the settling phase begins", () => {
    const instant = settlementInstant("2026-10-08");
    expect(instant.toISOString()).toBe("2026-10-08T05:35:00.000Z");
    expect(marketPhase(new Date(instant.getTime() - 60_000), [])).toBe("intraday");
    expect(marketPhase(instant, [])).toBe("settling");
  });
});
