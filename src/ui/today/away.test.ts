import { describe, expect, it } from "vitest";
import { threeDayRecap, WEEK_HEADLINE_BEGINNER, WEEK_HEADLINE_PRO } from "@/ui/test/recap-fixture";
import { AWAY_TAB_MIN_MISSED_DAYS, awayView, monthDay } from "@/ui/today/away";

describe("awayView", () => {
  it("is null without a recap", () => {
    expect(awayView(null, "beginner")).toBeNull();
  });

  it("is null when the device is up to date", () => {
    expect(awayView({ kind: "up-to-date", latestTradeDate: "2026-10-08" }, "beginner")).toBeNull();
  });

  it("is null when only one trading day was missed", () => {
    const recap = threeDayRecap();
    const oneDay = { ...recap, missedTradingDays: 1, days: recap.days.slice(-1) };
    expect(AWAY_TAB_MIN_MISSED_DAYS).toBe(2);
    expect(awayView(oneDay, "beginner")).toBeNull();
  });

  it("maps a three-day recap for the beginner lens", () => {
    const view = awayView(threeDayRecap(), "beginner");
    expect(view).toEqual({
      from: "2026-10-06",
      to: "2026-10-08",
      missedDays: 3,
      truncated: false,
      cumulativePct: -1.91,
      strongFrom: 40,
      strongTo: 32,
      rows: [
        {
          tradeDate: "2026-10-06",
          futuresChangePct: -0.42,
          summary: "大盤小跌，多數族群沒什麼動靜",
          weekHeadline: WEEK_HEADLINE_BEGINNER,
        },
        { tradeDate: "2026-10-07", futuresChangePct: -0.26, summary: null, weekHeadline: null },
        {
          tradeDate: "2026-10-08",
          futuresChangePct: -1.24,
          summary: "大盤又跌了一些，但不是每個族群都在跌",
          weekHeadline: null,
        },
      ],
    });
  });

  it("picks the pro lens text", () => {
    const view = awayView(threeDayRecap(), "pro");
    expect(view?.rows[0]?.summary).toBe("指數小跌，族群輪動平淡");
    expect(view?.rows[0]?.weekHeadline).toBe(WEEK_HEADLINE_PRO);
  });

  it("keeps the rows in date order", () => {
    const recap = threeDayRecap();
    const view = awayView({ ...recap, days: [...recap.days].reverse() }, "beginner");
    expect(view?.rows.map((r) => r.tradeDate)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
  });

  it("copies truncated and passes on missing numbers as null", () => {
    const view = awayView(
      {
        ...threeDayRecap(),
        truncated: true,
        cumulative: { futuresChangePct: null },
        quadrantShift: null,
      },
      "beginner",
    );
    expect(view?.truncated).toBe(true);
    expect(view?.cumulativePct).toBeNull();
    expect(view?.strongFrom).toBeNull();
    expect(view?.strongTo).toBeNull();
  });

  it("leaves the week headline null when that week has no briefing for the lens", () => {
    const recap = threeDayRecap();
    const weeks = recap.weeks.map((w) => ({ ...w, briefings: { ...w.briefings, pro: null } }));
    expect(awayView({ ...recap, weeks }, "pro")?.rows[0]?.weekHeadline).toBeNull();
  });
});

describe("monthDay", () => {
  it("formats MM/DD from the date string", () => {
    expect(monthDay("2026-10-06")).toBe("10/06");
    expect(monthDay("2027-01-01")).toBe("01/01");
  });
});
