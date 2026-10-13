import type { Lens } from "@/insight/lens";
import type { RecapJson } from "@/ui/data/api";

/** The away tab appears only after more than one missed trading day. */
export const AWAY_TAB_MIN_MISSED_DAYS = 2;
export const AWAY_NOTE = "每天的標題是 AI 整理的，數字來自當天資料";
export const TRUNCATED_NOTE = "只顯示最近 90 天";

export type AwayRow = {
  tradeDate: string;
  futuresChangePct: number | null;
  summary: string | null;
  weekHeadline: string | null;
};

export type AwayView = {
  from: string;
  to: string;
  missedDays: number;
  truncated: boolean;
  cumulativePct: number | null;
  strongFrom: number | null;
  strongTo: number | null;
  rows: AwayRow[];
};

/**
 * What the away tab shows for one lens, or null when there is no tab: no recap, nothing new, or
 * too few missed days. Only stored text and server numbers are passed on; nothing is made up.
 */
export function awayView(recap: RecapJson | null, lens: Lens): AwayView | null {
  if (recap === null || recap.kind !== "recap") return null;
  if (recap.missedTradingDays < AWAY_TAB_MIN_MISSED_DAYS) return null;
  const weekHeadline = (weekKey: string | null): string | null => {
    if (weekKey === null) return null;
    return recap.weeks.find((w) => w.weekKey === weekKey)?.briefings[lens]?.headline ?? null;
  };
  const rows = [...recap.days]
    .sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0))
    .map(
      (day): AwayRow => ({
        tradeDate: day.tradeDate,
        futuresChangePct: day.futuresChangePct,
        summary: day.summary[lens],
        weekHeadline: weekHeadline(day.coveredByWeek),
      }),
    );
  return {
    from: recap.from,
    to: recap.to,
    missedDays: recap.missedTradingDays,
    truncated: recap.truncated,
    cumulativePct: recap.cumulative.futuresChangePct,
    strongFrom: recap.quadrantShift?.from.強勢 ?? null,
    strongTo: recap.quadrantShift?.to.強勢 ?? null,
    rows,
  };
}

/** `MM/DD` straight from a `YYYY-MM-DD` string, so no time zone can shift it. */
export function monthDay(tradeDate: string): string {
  return `${tradeDate.slice(5, 7)}/${tradeDate.slice(8, 10)}`;
}
