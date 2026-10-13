import type { BriefingContent } from "@/insight/briefing-content";
import type { RecapJson } from "@/ui/data/api";

const weekly = (headline: string): BriefingContent => ({
  headline,
  summary: "這週大盤一路往下。",
  sections: [
    { title: "這週發生什麼事", body: "台指期連跌。" },
    { title: "錢往哪裡去", body: "錢從電子股往傳產移。" },
  ],
  takeaway: "偏弱的一週。",
  termIds: [],
});

export const WEEK_HEADLINE_BEGINNER = "這週大盤往下走";
export const WEEK_HEADLINE_PRO = "週線收黑，量縮整理";

/** A three-day recap after 2026-10-02; the first day is covered by a weekly briefing. */
export function threeDayRecap(): Extract<RecapJson, { kind: "recap" }> {
  return {
    kind: "recap",
    from: "2026-10-06",
    to: "2026-10-08",
    truncated: false,
    missedTradingDays: 3,
    days: [
      {
        tradeDate: "2026-10-06",
        futuresClose: 50100,
        futuresChangePct: -0.42,
        force: -0.2,
        breadth: 0.1,
        upGroups: 80,
        downGroups: 95,
        summary: { beginner: "大盤小跌，多數族群沒什麼動靜", pro: "指數小跌，族群輪動平淡" },
        coveredByWeek: "2026-W41",
      },
      {
        tradeDate: "2026-10-07",
        futuresClose: 49968,
        futuresChangePct: -0.26,
        force: -0.5,
        breadth: -0.3,
        upGroups: 60,
        downGroups: 115,
        summary: { beginner: null, pro: null },
        coveredByWeek: null,
      },
      {
        tradeDate: "2026-10-08",
        futuresClose: 49349,
        futuresChangePct: -1.24,
        force: -0.63,
        breadth: 0.2,
        upGroups: 87,
        downGroups: 88,
        summary: {
          beginner: "大盤又跌了一些，但不是每個族群都在跌",
          pro: "指數續跌，族群漲跌互見",
        },
        coveredByWeek: null,
      },
    ],
    weeks: [
      {
        weekKey: "2026-W41",
        from: "2026-10-05",
        to: "2026-10-11",
        briefings: { beginner: weekly(WEEK_HEADLINE_BEGINNER), pro: weekly(WEEK_HEADLINE_PRO) },
      },
    ],
    cumulative: { futuresChangePct: -1.91 },
    quadrantShift: {
      from: { 強勢: 40, 弱勢: 50, 轉強: 40, 轉弱: 45 },
      to: { 強勢: 32, 弱勢: 60, 轉強: 38, 轉弱: 45 },
    },
  };
}
