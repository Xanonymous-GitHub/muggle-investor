import type { Db } from "@/db/client";
import { listBriefings } from "@/db/repositories/briefings";
import { latestSnapshot, listClosedSnapshots } from "@/db/repositories/snapshots";
import { daysBetween, shiftDate } from "@/ingestion/shift-date";
import type { BriefingContent } from "@/insight/briefing-content";
import { LENSES, type Lens } from "@/insight/lens";
import { isoWeekKey, weekRange } from "@/insight/week";
import { logger } from "@/lib/logger";
import {
  type DigestSnapshot,
  digestSnapshotSchema,
  type QuadrantCounts,
} from "@/sources/darkfanxing/schemas";

/** The longest span, in calendar days back from the latest data date, a recap covers. */
export const RECAP_MAX_DAYS = 90;

/** Latest possible ISO date; upper bound for "everything newer". */
const END_OF_TIME = "9999-12-31";

export type RecapDay = {
  tradeDate: string;
  futuresClose: number | null;
  futuresChangePct: number | null;
  force: number;
  breadth: number;
  upGroups: number;
  downGroups: number;
  summary: Record<Lens, string | null>;
  coveredByWeek: string | null;
};

export type RecapWeek = {
  weekKey: string;
  from: string;
  to: string;
  briefings: Record<Lens, BriefingContent | null>;
};

export type Recap =
  | { kind: "up-to-date"; latestTradeDate: string | null }
  | {
      kind: "recap";
      from: string;
      to: string;
      truncated: boolean;
      missedTradingDays: number;
      days: RecapDay[];
      weeks: RecapWeek[];
      cumulative: { futuresChangePct: number | null };
      quadrantShift: { from: QuadrantCounts; to: QuadrantCounts } | null;
    };

const perLens = <T>(build: (lens: Lens) => T): Record<Lens, T> => ({
  beginner: build("beginner"),
  pro: build("pro"),
});

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Closed parsed digests dated after `lowerBound` (inclusive), ascending. A stored row that no
 * longer matches the digest schema is skipped; one warning per call reports how many.
 */
async function readDigests(db: Db, lowerBound: string): Promise<DigestSnapshot[]> {
  const rows = await listClosedSnapshots(db, "digest", lowerBound, END_OF_TIME, {
    parsedOnly: true,
  });
  const digests: DigestSnapshot[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const parsed = digestSnapshotSchema.safeParse(row.parsed);
    if (parsed.success) digests.push(parsed.data);
    else skipped.push(row.tradeDate);
  }
  if (skipped.length > 0) {
    logger.warn(
      { skipped: skipped.length, tradeDates: skipped },
      "recap skipped stored digests that no longer match their schema",
    );
  }
  return digests;
}

/** Futures move across the whole span, from the close before the first day to the last close. */
function cumulativeFuturesChangePct(first: DigestSnapshot, last: DigestSnapshot): number | null {
  const start = first.market.futures;
  const end = last.market.futures;
  if (!start || !end) return null;
  const base = start.close - start.change;
  if (base === 0) return null;
  return round2(((end.close - base) / base) * 100);
}

/**
 * What happened after `since` (the last trade date the client already saw, exclusive), from the
 * stored closed digests and briefings. Nothing is generated here: a missing briefing stays null.
 */
export async function getRecap(db: Db, input: { since: string; now: Date }): Promise<Recap> {
  const { since } = input;
  const newest = await latestSnapshot(db, "digest", { parsedOnly: true, session: "closed" });
  if (!newest) return { kind: "up-to-date", latestTradeDate: null };

  // Digests up to 6 days older than the first recap day are needed to judge whether a week is
  // fully inside the range; the lower bound keeps a long history from being loaded.
  const roughCutoff = shiftDate(newest.tradeDate, -RECAP_MAX_DAYS);
  const lowest = since > roughCutoff ? since : roughCutoff;
  const digests = await readDigests(db, shiftDate(lowest, -6));
  const last = digests.at(-1);
  if (!last) return { kind: "up-to-date", latestTradeDate: null };
  const latest = last.tradeDate;
  if (since >= latest) return { kind: "up-to-date", latestTradeDate: latest };

  const truncated = daysBetween(since, latest) > RECAP_MAX_DAYS;
  const cutoff = truncated ? shiftDate(latest, -RECAP_MAX_DAYS) : since;
  const inRange = digests.filter((d) => d.tradeDate > cutoff);
  const first = inRange[0];
  if (!first) return { kind: "up-to-date", latestTradeDate: latest };

  const firstWeek = isoWeekKey(first.tradeDate);
  const lastWeek = isoWeekKey(latest);
  const [dailies, weeklies] = await Promise.all([
    Promise.all(LENSES.map((lens) => listBriefings(db, "daily", first.tradeDate, latest, lens))),
    Promise.all(LENSES.map((lens) => listBriefings(db, "weekly", firstWeek, lastWeek, lens))),
  ]);
  const summaryOf = (date: string, lens: Lens): string | null =>
    dailies[LENSES.indexOf(lens)]?.find((b) => b.periodKey === date)?.content.summary ?? null;

  // A week counts only when every stored digest of it is in range and a weekly briefing exists.
  const weeks: RecapWeek[] = [];
  for (let week = firstWeek; week <= lastWeek; ) {
    const range = weekRange(week);
    const weekDigests = digests.filter((d) => d.tradeDate >= range.from && d.tradeDate <= range.to);
    const briefings = perLens(
      (lens) => weeklies[LENSES.indexOf(lens)]?.find((b) => b.periodKey === week)?.content ?? null,
    );
    if (
      weekDigests.length > 0 &&
      weekDigests.every((d) => d.tradeDate > cutoff) &&
      (briefings.beginner || briefings.pro)
    ) {
      weeks.push({ weekKey: week, from: range.from, to: range.to, briefings });
    }
    week = isoWeekKey(shiftDate(range.to, 1));
  }
  const coveredBy = (date: string): string | null =>
    weeks.find((w) => date >= w.from && date <= w.to)?.weekKey ?? null;

  const days = inRange.map(
    (d): RecapDay => ({
      tradeDate: d.tradeDate,
      futuresClose: d.market.futures?.close ?? null,
      futuresChangePct: d.market.futures?.changePct ?? null,
      force: d.market.force,
      breadth: d.market.breadth,
      upGroups: d.market.upGroups,
      downGroups: d.market.downGroups,
      summary: perLens((lens) => summaryOf(d.tradeDate, lens)),
      coveredByWeek: coveredBy(d.tradeDate),
    }),
  );

  const quadrantFrom = first.quadrant?.counts.today;
  const quadrantTo = last.quadrant?.counts.today;
  return {
    kind: "recap",
    from: first.tradeDate,
    to: latest,
    truncated,
    missedTradingDays: days.length,
    days,
    weeks,
    cumulative: { futuresChangePct: cumulativeFuturesChangePct(first, last) },
    quadrantShift: quadrantFrom && quadrantTo ? { from: quadrantFrom, to: quadrantTo } : null,
  };
}
