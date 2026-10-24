import { describe, expect, it } from "vitest";
import type { MarketHoliday } from "@/sources/twse";
import { assessFreshness } from "./freshness";

// 2026-10-09 is a Friday, 10-10 a Saturday, 10-12 a Monday.
const at = (iso: string) => new Date(iso);
const NONE: MarketHoliday[] = [];
const holiday = (date: string): MarketHoliday => ({ date, isTradingDay: false }) as MarketHoliday;

describe("assessFreshness", () => {
  it("does not call Friday's close stale on a Saturday or Sunday", () => {
    for (const now of ["2026-10-10T04:00:00Z", "2026-10-11T04:00:00Z"]) {
      expect(
        assessFreshness({
          dataDate: "2026-10-09",
          session: "closed",
          now: at(now),
          holidays: NONE,
        }),
      ).toMatchObject({ state: "current", expectedDate: "2026-10-09", tradingDaysBehind: 0 });
    }
  });

  it("does not call the last session before a holiday stale", () => {
    // Fri 10-09 is a holiday, so Thu 10-08 is the latest session that can exist on Sat 10-10.
    expect(
      assessFreshness({
        dataDate: "2026-10-08",
        session: "closed",
        now: at("2026-10-10T04:00:00Z"),
        holidays: [holiday("2026-10-09")],
      }),
    ).toMatchObject({ state: "current", expectedDate: "2026-10-08" });
  });

  it("is current before today's open and during the session on yesterday's close", () => {
    // Mon 10-12 08:00 and 10:00 Taipei.
    for (const now of ["2026-10-12T00:00:00Z", "2026-10-12T02:00:00Z"]) {
      expect(
        assessFreshness({
          dataDate: "2026-10-09",
          session: "closed",
          now: at(now),
          holidays: NONE,
        }),
      ).toMatchObject({ state: "current", expectedDate: "2026-10-09" });
    }
  });

  it("is behind once a settled session is missing, and counts the trading days", () => {
    // Tue 10-13 evening: Mon 10-12 has settled, Friday's data misses it.
    expect(
      assessFreshness({
        dataDate: "2026-10-09",
        session: "closed",
        now: at("2026-10-13T11:00:00Z"),
        holidays: NONE,
      }),
    ).toMatchObject({ state: "behind", expectedDate: "2026-10-13", tradingDaysBehind: 2 });
  });

  it("counts a settled session today as expected only after the close-out", () => {
    // Mon 10-12 14:30 Taipei: today has settled.
    expect(
      assessFreshness({
        dataDate: "2026-10-09",
        session: "closed",
        now: at("2026-10-12T06:30:00Z"),
        holidays: NONE,
      }),
    ).toMatchObject({ state: "behind", expectedDate: "2026-10-12", tradingDaysBehind: 1 });
  });

  it("labels an intraday snapshot provisional, even from the latest session and after the close", () => {
    const during = assessFreshness({
      dataDate: "2026-10-12",
      session: "intraday",
      now: at("2026-10-12T03:00:00Z"),
      holidays: NONE,
    });
    expect(during).toMatchObject({ state: "provisional", marketOpenNow: true });
    const after = assessFreshness({
      dataDate: "2026-10-12",
      session: "intraday",
      now: at("2026-10-12T09:00:00Z"),
      holidays: NONE,
    });
    expect(after).toMatchObject({ state: "provisional", marketOpenNow: false });
  });

  it("still says behind for an intraday snapshot of a session that is long over", () => {
    expect(
      assessFreshness({
        dataDate: "2026-10-08",
        session: "intraday",
        now: at("2026-10-13T11:00:00Z"),
        holidays: NONE,
      }),
    ).toMatchObject({ state: "behind", tradingDaysBehind: 3 });
  });

  it("does not guess for an observation of unknown session", () => {
    expect(
      assessFreshness({
        dataDate: "2026-10-09",
        session: "unknown",
        now: at("2026-10-10T04:00:00Z"),
        holidays: NONE,
      }).state,
    ).toBe("unknown");
  });

  it("treats a price series like a closed observation", () => {
    expect(
      assessFreshness({
        dataDate: "2026-09-01",
        session: "series",
        now: at("2026-10-10T04:00:00Z"),
        holidays: NONE,
      }),
    ).toMatchObject({ state: "behind" });
  });
});
