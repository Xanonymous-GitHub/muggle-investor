// Pure shaping of the closed digest and the latest briefing into what the 今天 tab shows.
import type { Lens } from "@/insight/lens";
import type { DigestSnapshot, FlowRow } from "@/sources/darkfanxing/schemas";
import type { BriefingJson } from "@/ui/data/api";
import { formatInt, formatPct, formatYi, NO_VALUE, type Trend, trendOf } from "@/ui/format";

/** Fixed by the screen, never by the LLM. */
export const DISCLAIMER = "以上為資料整理與教育說明，不構成投資建議。";
export const AI_NOTE = "標題與說明由 AI 整理，數字來自當天資料";
export const MOVER_ROWS = 5;
export const FLOW_ROWS = 3;

/** The trend of `n` as printed with `digits` decimals, so a value shown as 0 is never coloured. */
const shownTrend = (n: number, digits = 2): Trend => trendOf(Number(n.toFixed(digits)));

/** A whole-point move with its sign and grouped thousands: `-1,234 點`, `0 點`. */
function formatPoints(change: number): string {
  if (!Number.isFinite(change)) return NO_VALUE;
  const points = Math.round(Math.abs(change));
  if (points === 0) return "0 點";
  return `${change < 0 ? "-" : "+"}${formatInt(points)} 點`;
}

export type Breadth = { up: number; down: number; upPct: number };

/** Share of rising groups among rising plus falling ones; null when neither exists. */
export function breadthBar(market: DigestSnapshot["market"]): Breadth | null {
  const up = market.upGroups;
  const down = market.downGroups;
  if (up + down === 0) return null;
  return { up, down, upPct: Math.round((up / (up + down)) * 1000) / 10 };
}

export type Tile = { id: string; label: string; value: string; trend: Trend };

export function todayTiles(digest: DigestSnapshot, lens: Lens): Tile[] {
  const { market } = digest;
  const tiles: Tile[] = [];
  if (market.futures) {
    const { close, change, changePct } = market.futures;
    tiles.push(
      { id: "futures-close", label: "台指期收盤", value: formatInt(close), trend: "flat" },
      {
        id: "futures-change",
        label: "漲跌",
        value: formatPoints(change),
        trend: shownTrend(change, 0),
      },
      {
        id: "futures-change-pct",
        label: "漲跌幅",
        value: formatPct(changePct),
        trend: shownTrend(changePct),
      },
    );
  }
  tiles.push({
    id: "groups",
    label: "漲／跌族群",
    value: `${market.upGroups} / ${market.downGroups}`,
    trend: "flat",
  });
  if (lens === "pro") {
    tiles.push(
      {
        id: "force",
        label: "力度",
        value: formatPct(market.force),
        trend: shownTrend(market.force),
      },
      {
        id: "breadth",
        label: "面積",
        value: formatPct(market.breadth),
        trend: shownTrend(market.breadth),
      },
    );
  }
  return tiles;
}

export type BriefingState =
  | {
      kind: "current";
      headline: string;
      summary: string;
      sections: { title: string; body: string }[];
      takeaway: string;
      termIds: string[];
      periodKey: string;
    }
  | { kind: "otherDay"; headline: string; periodKey: string }
  | { kind: "pending" };

/**
 * Whether the latest briefing speaks for the digest's day. One for any other day (earlier, or
 * later than a cached digest whose refresh failed) is only ever shown under its own date.
 */
export function briefingState(
  digestTradeDate: string,
  briefing: BriefingJson | null,
): BriefingState {
  if (briefing === null) return { kind: "pending" };
  const { periodKey, content } = briefing.briefing;
  if (periodKey !== digestTradeDate)
    return { kind: "otherDay", headline: content.headline, periodKey };
  return {
    kind: "current",
    headline: content.headline,
    summary: content.summary,
    sections: content.sections,
    takeaway: content.takeaway,
    termIds: content.termIds,
    periodKey,
  };
}

export type Row = { name: string; value: string; trend: Trend };

export function moverRows(
  list: readonly { name: string; changePct: number }[] | null,
  limit = MOVER_ROWS,
): Row[] {
  return (list ?? []).slice(0, limit).map((m) => ({
    name: m.name,
    value: formatPct(m.changePct),
    trend: shownTrend(m.changePct),
  }));
}

export function flowRows(list: readonly FlowRow[] | null, limit = FLOW_ROWS): Row[] {
  return (list ?? []).slice(0, limit).map((f) => ({
    name: f.name,
    value: formatYi(f.netFlow),
    trend: shownTrend(f.netFlow),
  }));
}
