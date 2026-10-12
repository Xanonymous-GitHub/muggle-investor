import type { Logger } from "pino";
import type { Db } from "@/db/client";
import { hasBriefing, listBriefings } from "@/db/repositories/briefings";
import { getHolidays, replaceHolidays } from "@/db/repositories/calendar";
import { latestPriceDate, upsertCorporateActions, upsertPriceBars } from "@/db/repositories/prices";
import {
  getClosedSnapshot,
  hasSnapshot,
  listClosedSnapshots,
  type NewSnapshot,
  saveSnapshot,
} from "@/db/repositories/snapshots";
import type { WeeklyDay } from "@/insight/facts-weekly";
import { generateDailyBriefing } from "@/insight/generate-daily";
import { generateWeeklyBriefing } from "@/insight/generate-weekly";
import { LENSES, type Lens } from "@/insight/lens";
import type { Llm } from "@/insight/llm";
import type { ProduceDeps, ProduceResult } from "@/insight/pipeline";
import { DAILY_PROMPT_VERSION } from "@/insight/prompts/daily";
import { WEEKLY_PROMPT_VERSION } from "@/insight/prompts/weekly";
import { isoWeekKey, isWeekComplete, weekRange } from "@/insight/week";
import {
  lastSettledTradeDate,
  type MarketPhase,
  marketPhase,
  toTaipei,
} from "@/market-clock/market-clock";
import {
  type DarkfanxingClient,
  type DigestSnapshot,
  type Fetched,
  redactKey,
  type SectorBoard,
  type TitleMeta,
} from "@/sources/darkfanxing";
import { digestSnapshotSchema, sectorBoardSchema } from "@/sources/darkfanxing/schemas";
import type { FinMindClient } from "@/sources/finmind";
import type { MarketHoliday, TwseClient } from "@/sources/twse";
import { reparseSnapshots } from "./reparse";
import { snapshotRow } from "./snapshot-row";
import { TRACKED_SYMBOLS } from "./tracked-symbols";

export type IngestionDeps = {
  db: Db;
  darkfanxing: DarkfanxingClient;
  /** Scrubbed from stored raw HTML and from every report detail; never persisted or returned. */
  darkfanxingKey: string;
  finmind: FinMindClient;
  twse: TwseClient;
  /** Writes the daily and weekly briefings; an outage only fails the briefing actions. */
  llm: Llm;
  now: Date;
  logger: Logger;
};

export type IngestionAction = {
  name: string;
  status: "done" | "skipped" | "failed";
  detail?: string;
};

/** `phase` is null only when the trading calendar could not be loaded (see the `calendar` action). */
export type IngestionReport = { phase: MarketPhase | null; actions: IngestionAction[] };

type Outcome = Omit<IngestionAction, "name">;

type Attempt<T> = { ok: true; value: T } | { ok: false };

type Recorder = {
  /** Runs a step and records its outcome; a throw becomes a `failed` action. */
  record(name: string, step: () => Promise<Outcome>): Promise<void>;
  /**
   * Computes a value later steps depend on. A throw is recorded as a `failed` action under each
   * of `names` (the steps that can no longer run) and the caller skips them.
   */
  attempt<T>(names: readonly string[], compute: () => T | Promise<T>): Promise<Attempt<T>>;
};

/** First date requested when a symbol has no stored bars yet. */
const BACKFILL_START = "2010-01-01";
/** Dividend results can be published after the ex-date; re-fetching a window makes that safe (upserts are idempotent). */
const CORPORATE_ACTION_LOOKBACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Earlier closed digests briefed per lens per run, and how far back they may lie from the settled date. */
const BRIEFING_CATCH_UP_MAX_DATES = 4;
const BRIEFING_CATCH_UP_WINDOW_DAYS = 14;

const shiftDate = (date: string, days: number): string =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

const failure = (error: unknown): Outcome => ({
  status: "failed",
  detail: error instanceof Error ? error.message : String(error),
});

/**
 * One scheduled ingestion pass. Fetches what the current market phase calls for and stores it
 * idempotently. Every step, including the reads later steps depend on, is reported separately;
 * a failing step never aborts the run, it only skips the steps that need its result.
 * Darkfanxing requests per run: 1 intraday/settling, at most 2 otherwise.
 */
export async function runIngestion(deps: IngestionDeps): Promise<IngestionReport> {
  const { db, now, logger } = deps;
  const scrub = (text: string) => redactKey(text, deps.darkfanxingKey, "***");
  const actions: IngestionAction[] = [];

  const push = (name: string, outcome: Outcome): void => {
    const action: IngestionAction = {
      name,
      status: outcome.status,
      ...(outcome.detail !== undefined && { detail: scrub(outcome.detail) }),
    };
    actions.push(action);
    if (action.status === "failed") logger.error(action, "ingestion action failed");
    else logger.info(action, "ingestion action");
  };
  const recorder: Recorder = {
    async record(name, step) {
      let outcome: Outcome;
      try {
        outcome = await step();
      } catch (error) {
        outcome = failure(error);
      }
      push(name, outcome);
    },
    async attempt(names, compute) {
      try {
        return { ok: true, value: await compute() };
      } catch (error) {
        for (const name of names) push(name, failure(error));
        return { ok: false };
      }
    },
  };
  const { record, attempt } = recorder;

  const today = toTaipei(now).date;
  const year = Number(today.slice(0, 4));
  await record("holidays", () => refreshHolidays(deps, year));
  const calendar = await attempt(["calendar"], async () => {
    // The previous year matters for look-backs across New Year.
    const holidays = [...(await getHolidays(db, year - 1)), ...(await getHolidays(db, year))];
    return { holidays, phase: marketPhase(now, holidays) };
  });
  if (!calendar.ok) return { phase: null, actions };
  const { holidays, phase } = calendar.value;

  if (phase === "intraday" || phase === "settling") {
    await record("sector_board", async () => {
      const { row, inserted } = await store(deps, scrub, "sector_board", () =>
        deps.darkfanxing.fetchSectorBoard(),
      );
      return parseFailure(row) ?? { status: "done", detail: summarize(row, inserted) };
    });
    return { phase, actions };
  }

  // post-close, closed-day, pre-open: repair stored snapshots first (a repaired closed row
  // satisfies the catch-up check below), then catch up on the last settled session, then prices,
  // and the LLM briefings last: an LLM outage (up to its timeout per call) must not delay prices.
  await record("reparse", () => reparse(deps));
  const settled = await attempt(["last_settled_trade_date"], () =>
    lastSettledTradeDate(now, holidays),
  );
  if (!settled.ok) return { phase, actions };
  const expected = settled.value;
  await record("digest", () =>
    catchUp(deps, scrub, "digest", expected, () => deps.darkfanxing.fetchDigest()),
  );
  await record("sector_board", () =>
    catchUp(deps, scrub, "sector_board", expected, () => deps.darkfanxing.fetchSectorBoard()),
  );
  for (const symbol of TRACKED_SYMBOLS) {
    await ingestPrices(deps, recorder, symbol, expected, today);
  }
  await generateBriefings(deps, recorder, expected, holidays);
  return { phase, actions };
}

/** Re-parses a bounded batch of unparsed or outdated stored snapshots (no upstream requests). */
async function reparse({ db, logger }: IngestionDeps): Promise<Outcome> {
  const { scanned, fixed, stillFailing, conflicts } = await reparseSnapshots({ db, logger });
  if (scanned === 0) return { status: "skipped", detail: "no snapshots to re-parse" };
  return {
    status: "done",
    detail: `scanned ${scanned}, fixed ${fixed}, still failing ${stillFailing}, conflicts ${conflicts}`,
  };
}

async function refreshHolidays({ db, twse }: IngestionDeps, year: number): Promise<Outcome> {
  if ((await getHolidays(db, year)).length > 0) {
    return { status: "skipped", detail: `${year} calendar already stored` };
  }
  const holidays = await twse.fetchHolidaySchedule();
  if (!holidays.some((holiday) => holiday.date.startsWith(`${year}-`))) {
    return {
      status: "failed",
      detail: `TWSE schedule has no ${year} rows (${holidays.length} rows); stored calendar kept`,
    };
  }
  await replaceHolidays(db, holidays);
  return { status: "done", detail: `${holidays.length} rows` };
}

/** Fetches the closed snapshot for `expected` unless one is already stored; "done" only once a closed row is stored. */
async function catchUp<T extends TitleMeta>(
  deps: IngestionDeps,
  scrub: (text: string) => string,
  kind: "digest" | "sector_board",
  expected: string,
  fetch: () => Promise<Fetched<T>>,
): Promise<Outcome> {
  if (await hasSnapshot(deps.db, kind, expected, { session: "closed" })) {
    return { status: "skipped", detail: `closed ${kind} for ${expected} already stored` };
  }
  const { row, inserted } = await store(deps, scrub, kind, fetch);
  const failure = parseFailure(row);
  if (failure) return failure;
  if (row.tradeDate < expected) {
    return {
      status: "skipped",
      detail: `upstream not yet updated: serves ${row.tradeDate}, expected ${expected}`,
    };
  }
  // Only a closed row satisfies the hasSnapshot check above; anything else is retried next run.
  if (row.session !== "closed") {
    return {
      status: "skipped",
      detail: `upstream session not closed yet: ${summarize(row, inserted)}`,
    };
  }
  return { status: "done", detail: summarize(row, inserted) };
}

/** Fetches one report and saves it (key scrubbed), dated by its content. */
async function store<T extends TitleMeta>(
  { db, logger }: IngestionDeps,
  scrub: (text: string) => string,
  kind: "digest" | "sector_board",
  fetch: () => Promise<Fetched<T>>,
): Promise<{ row: NewSnapshot; inserted: boolean }> {
  const row = snapshotRow(kind, null, await fetch(), scrub);
  const { inserted } = await saveSnapshot(db, row);
  if (row.parseError !== null) {
    logger.error(
      { kind, tradeDate: row.tradeDate, parseError: row.parseError },
      "darkfanxing parse failed; raw saved",
    );
  }
  return { row, inserted };
}

const parseFailure = (row: NewSnapshot): Outcome | null =>
  row.parseError
    ? { status: "failed", detail: `parse failed, raw saved: ${row.parseError}` }
    : null;

const summarize = (row: NewSnapshot, inserted: boolean): string =>
  `${row.tradeDate}${row.asOf ? ` ${row.asOf}` : ""} ${row.session}, ${inserted ? "inserted" : "already stored"}`;

async function ingestPrices(
  { db, finmind }: IngestionDeps,
  { record, attempt }: Recorder,
  symbol: string,
  expected: string,
  today: string,
): Promise<void> {
  const pricesAction = `prices:${symbol}`;
  const corporateActionsAction = `corporate_actions:${symbol}`;
  const stored = await attempt([pricesAction, corporateActionsAction], () =>
    latestPriceDate(db, symbol),
  );
  if (!stored.ok) return;
  const latest = stored.value;
  if (latest !== null && latest >= expected) {
    const upToDate = async (): Promise<Outcome> => ({
      status: "skipped",
      detail: `up to date (${latest})`,
    });
    await record(pricesAction, upToDate);
    await record(corporateActionsAction, upToDate);
    return;
  }

  const from = latest === null ? BACKFILL_START : shiftDate(latest, 1);
  await record(pricesAction, async () => {
    const bars = await finmind.fetchPrices(symbol, from, today);
    await upsertPriceBars(db, bars);
    return { status: "done", detail: `${bars.length} bars from ${from}` };
  });

  const actionsFrom =
    latest === null ? BACKFILL_START : shiftDate(from, -CORPORATE_ACTION_LOOKBACK_DAYS);
  await record(corporateActionsAction, async () => {
    const corporateActions = await finmind.fetchCorporateActions(symbol, actionsFrom);
    await upsertCorporateActions(db, corporateActions);
    return { status: "done", detail: `${corporateActions.length} actions from ${actionsFrom}` };
  });
}

const briefingVersion = { daily: DAILY_PROMPT_VERSION, weekly: WEEKLY_PROMPT_VERSION } as const;

const outcomeOf = (result: ProduceResult): Outcome => {
  if (result.status === "saved") return { status: "done" };
  if (result.status === "skipped") return { status: "skipped", detail: "already stored" };
  return { status: "skipped", detail: `rejected: ${(result.reasons ?? []).join("; ")}` };
};

/** The parsed closed digest of `date`, re-validated; null when missing, unparsed or no longer valid. */
async function loadDigest(
  { db, logger }: IngestionDeps,
  date: string,
): Promise<DigestSnapshot | null> {
  const row = await getClosedSnapshot(db, "digest", date);
  return row ? validDigest(row.parsed, date, logger) : null;
}

function validDigest(parsed: unknown, date: string, logger: Logger): DigestSnapshot | null {
  const result = digestSnapshotSchema.safeParse(parsed);
  if (result.success) return result.data;
  logger.error({ date, error: result.error.message }, "stored digest no longer validates");
  return null;
}

/** The closed board of `date` when it validates, else null (a missing board only thins the facts). */
async function loadBoard({ db, logger }: IngestionDeps, date: string): Promise<SectorBoard | null> {
  const row = await getClosedSnapshot(db, "sector_board", date);
  if (!row) return null;
  const result = sectorBoardSchema.safeParse(row.parsed);
  if (result.success && result.data.tradeDate === date) return result.data;
  logger.error({ date }, "stored sector board does not validate for its date; briefing without it");
  return null;
}

/**
 * Daily briefings for the settled date `expected` and up to a few earlier closed digests that
 * lack one, then the weekly briefing once the week is complete. Each (lens, date) is its own
 * recorded action, so one failure (LLM outage, rejected output) never stops the rest.
 * The settled date comes first so the newest briefing is not starved by a slow LLM.
 */
async function generateBriefings(
  deps: IngestionDeps,
  { record, attempt }: Recorder,
  expected: string,
  holidays: MarketHoliday[],
): Promise<void> {
  const { db, llm, logger, now } = deps;
  const produceDeps: ProduceDeps = { db, llm, logger, now: () => now };

  const dailyFor = async (lens: Lens, date: string): Promise<Outcome> => {
    if (await hasBriefing(db, "daily", date, lens, briefingVersion.daily)) {
      return { status: "skipped", detail: "already stored" };
    }
    const digest = await loadDigest(deps, date);
    if (!digest) return { status: "skipped", detail: `no parsed closed digest for ${date}` };
    const board = await loadBoard(deps, date);
    return outcomeOf(await generateDailyBriefing(produceDeps, { digest, board, lens }));
  };

  for (const lens of LENSES) {
    await record(`briefing:daily:${lens}`, () => dailyFor(lens, expected));
    const earlier = await attempt([`briefing:daily:${lens}:catch-up`], () =>
      datesMissingDaily(deps, lens, expected),
    );
    if (!earlier.ok) continue;
    for (const date of earlier.value) {
      await record(`briefing:daily:${lens}:${date}`, () => dailyFor(lens, date));
    }
  }

  // `isWeekComplete` is only true for the week holding its latest close, so ask about the week
  // of the settled date with that date as the latest close; a week already past is never revisited.
  const weekKey = isoWeekKey(expected);
  if (!isWeekComplete(weekKey, holidays, expected)) return;
  for (const lens of LENSES) {
    await record(`briefing:weekly:${lens}`, async () => {
      if (await hasBriefing(db, "weekly", weekKey, lens, briefingVersion.weekly)) {
        return { status: "skipped", detail: "already stored" };
      }
      const days = await weeklyDays(deps, weekKey, lens);
      if (days.length === 0)
        return { status: "skipped", detail: `no parsed closed digest in ${weekKey}` };
      return outcomeOf(await generateWeeklyBriefing(produceDeps, { weekKey, days, lens }));
    });
  }
}

/**
 * The up-to-4 most recent closed, parsed, valid digests before `expected` (within 14 days) that
 * lack a daily briefing in `lens`, oldest first.
 */
async function datesMissingDaily(
  { db, logger }: IngestionDeps,
  lens: Lens,
  expected: string,
): Promise<string[]> {
  const rows = await listClosedSnapshots(
    db,
    "digest",
    shiftDate(expected, -BRIEFING_CATCH_UP_WINDOW_DAYS),
    shiftDate(expected, -1),
    { parsedOnly: true },
  );
  const missing: string[] = [];
  for (const row of rows) {
    if (validDigest(row.parsed, row.tradeDate, logger) === null) continue;
    if (!(await hasBriefing(db, "daily", row.tradeDate, lens, briefingVersion.daily))) {
      missing.push(row.tradeDate);
    }
  }
  return missing.slice(-BRIEFING_CATCH_UP_MAX_DATES);
}

/** The week's closed digests with each day's same-lens daily summary (null when it has none). */
async function weeklyDays(
  { db, logger }: IngestionDeps,
  weekKey: string,
  lens: Lens,
): Promise<WeeklyDay[]> {
  const { from, to } = weekRange(weekKey);
  const [rows, dailies] = await Promise.all([
    listClosedSnapshots(db, "digest", from, to, { parsedOnly: true }),
    listBriefings(db, "daily", from, to, lens),
  ]);
  const summaries = new Map(dailies.map((b) => [b.periodKey, b.content.summary]));
  const days: WeeklyDay[] = [];
  for (const row of rows) {
    const digest = validDigest(row.parsed, row.tradeDate, logger);
    if (digest) days.push({ digest, dailySummary: summaries.get(row.tradeDate) ?? null });
  }
  return days;
}
