import type { Db } from "@/db/client";
import { listBriefingsTolerant } from "@/db/repositories/briefings";
import { latestClosedTradeDate, listClosedSnapshots } from "@/db/repositories/snapshots";
import { daysBetween, shiftDate } from "@/ingestion/shift-date";
import type { BriefingContent } from "@/insight/briefing-content";
import { LENSES, type Lens } from "@/insight/lens";
import { isoWeekKey, weekRange } from "@/insight/week";
import { logger } from "@/lib/logger";
import { futuresChainBreaks } from "@/market/futures-chain";
import {
  type DigestSnapshot,
  digestSnapshotSchema,
  type QuadrantCounts,
} from "@/sources/darkfanxing/schemas";

/** The longest span, in calendar days back from the latest data date, a recap covers. */
export const RECAP_MAX_DAYS = 90;

/**
 * Stored closed digests exist but none could be read: every one the bounded window walk reached
 * failed its schema, or the walk gave up after `MAX_WINDOW_STEPS`. Carries no row data or secrets.
 */
export class RecapUnavailableError extends Error {
  override name = "RecapUnavailableError";
  constructor() {
    super("No stored digest could be read for the recap");
  }
}

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
 * Closed parsed digests dated on or after `lowerBound`, ascending. A stored row that no longer
 * matches the digest schema is left out and named in `skipped`.
 */
async function readDigests(
  db: Db,
  lowerBound: string,
): Promise<{ digests: DigestSnapshot[]; skipped: string[] }> {
  const rows = await listClosedSnapshots(db, "digest", lowerBound, END_OF_TIME, {
    parsedOnly: true,
  });
  const digests: DigestSnapshot[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const parsed = digestSnapshotSchema.safeParse(row.parsed);
    if (parsed.success) digests.push(parsed.data);
    else skipped.push(`digest ${row.tradeDate}`);
  }
  return { digests, skipped };
}

/**
 * Futures move across the whole span, from the close before the first day to the last close.
 * Null when an end day has no futures, or when adjacent days of the span do not chain (a
 * contract rollover), since the first and last closes are then not one comparable series.
 */
function cumulativeFuturesChangePct(span: readonly DigestSnapshot[]): number | null {
  const start = span[0]?.market.futures;
  const end = span.at(-1)?.market.futures;
  if (!start || !end) return null;
  const chain = span.map((d) => ({ tradeDate: d.tradeDate, futures: d.market.futures }));
  if (futuresChainBreaks(chain)) return null;
  const base = start.close - start.change;
  if (base === 0) return null;
  return round2(((end.close - base) / base) * 100);
}

/** The most older anchors `readWindow` tries before giving up on finding a valid digest. */
const MAX_WINDOW_STEPS = 5;

type Window = { digests: DigestSnapshot[]; skipped: string[]; exhausted: boolean };

/**
 * The digests a recap needs, anchored on the latest stored digest that still matches its schema.
 * When `since` is not before the anchor nothing is recapped, so only the anchor day is read;
 * otherwise the read starts up to 6 days before the first recap day (to judge whether a week is
 * fully inside the range) and never reaches back past the 90-day cap. `anchor` starts at the
 * newest stored date and moves strictly older while its digest is invalid, at most
 * `MAX_WINDOW_STEPS` times, so the walk always ends and never scans an unbounded history.
 */
async function readWindow(db: Db, since: string, newest: string): Promise<Window> {
  const skipped = new Set<string>();
  let anchor = newest;
  for (let step = 0; step < MAX_WINDOW_STEPS; step++) {
    const roughCutoff = shiftDate(anchor, -RECAP_MAX_DAYS);
    const lowerBound =
      since >= anchor ? anchor : shiftDate(since > roughCutoff ? since : roughCutoff, -6);
    const read = await readDigests(db, lowerBound);
    for (const row of read.skipped) skipped.add(row);
    const last = read.digests.at(-1);
    if (last?.tradeDate === anchor) {
      return { digests: read.digests, skipped: [...skipped], exhausted: false };
    }
    // Everything at or above the anchor within this window was invalid; try the next older day.
    const next = last
      ? last.tradeDate
      : await latestClosedTradeDate(db, "digest", { onOrBefore: shiftDate(lowerBound, -1) });
    if (!next) return { digests: [], skipped: [...skipped], exhausted: false };
    anchor = next;
  }
  return { digests: [], skipped: [...skipped], exhausted: true };
}

/**
 * What happened after `since` (the last trade date the client already saw, exclusive), from the
 * stored closed digests and briefings. Nothing is generated here: a missing briefing stays null.
 * `up-to-date` with a null `latestTradeDate` means the database holds no closed digest at all.
 *
 * Throws `RecapUnavailableError` when closed digests are stored but none can be read.
 */
export async function getRecap(db: Db, input: { since: string; now: Date }): Promise<Recap> {
  const report = { skipped: [] as string[], exhausted: false };
  try {
    return await buildRecap(db, input.since, report);
  } finally {
    if (report.skipped.length > 0 || report.exhausted) {
      logger.warn(
        { skipped: report.skipped.length, rows: report.skipped, gaveUp: report.exhausted },
        "recap left out stored rows that no longer match their schema",
      );
    }
  }
}

async function buildRecap(
  db: Db,
  since: string,
  report: { skipped: string[]; exhausted: boolean },
): Promise<Recap> {
  const newest = await latestClosedTradeDate(db, "digest");
  if (!newest) return { kind: "up-to-date", latestTradeDate: null };

  const read = await readWindow(db, since, newest);
  report.skipped.push(...read.skipped);
  report.exhausted = read.exhausted;
  const { digests } = read;
  const last = digests.at(-1);
  // Digests are stored (newest exists) but the walk found none that still reads.
  if (!last) throw new RecapUnavailableError();
  const latest = last.tradeDate;
  if (since >= latest) return { kind: "up-to-date", latestTradeDate: latest };

  const spansCap = daysBetween(since, latest) > RECAP_MAX_DAYS;
  const cutoff = spansCap ? shiftDate(latest, -RECAP_MAX_DAYS) : since;
  // Truncated only when the cap actually left out a stored day that follows `since`.
  const omitted = spansCap
    ? await latestClosedTradeDate(db, "digest", { onOrBefore: cutoff })
    : null;
  const truncated = omitted !== null && omitted > since;
  const inRange = digests.filter((d) => d.tradeDate > cutoff);
  const first = inRange[0];
  if (!first) return { kind: "up-to-date", latestTradeDate: latest };

  const firstWeek = isoWeekKey(first.tradeDate);
  const lastWeek = isoWeekKey(latest);
  const [dailyReads, weeklyReads] = await Promise.all([
    Promise.all(
      LENSES.map((lens) => listBriefingsTolerant(db, "daily", first.tradeDate, latest, lens)),
    ),
    Promise.all(
      LENSES.map((lens) => listBriefingsTolerant(db, "weekly", firstWeek, lastWeek, lens)),
    ),
  ]);
  for (const read of [...dailyReads, ...weeklyReads]) report.skipped.push(...read.skipped);
  const dailies = dailyReads.map((read) => read.briefings);
  const weeklies = weeklyReads.map((read) => read.briefings);
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
    cumulative: { futuresChangePct: cumulativeFuturesChangePct(inRange) },
    quadrantShift: quadrantFrom && quadrantTo ? { from: quadrantFrom, to: quadrantTo } : null,
  };
}
