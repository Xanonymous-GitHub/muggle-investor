import type { Logger } from "pino";
import type { Db } from "@/db/client";
import { getHolidays, replaceHolidays } from "@/db/repositories/calendar";
import { latestPriceDate, upsertCorporateActions, upsertPriceBars } from "@/db/repositories/prices";
import { hasSnapshot, type NewSnapshot, saveSnapshot } from "@/db/repositories/snapshots";
import type { Llm } from "@/insight/llm";
import {
  lastSettledTradeDate,
  type MarketPhase,
  marketPhase,
  toTaipei,
} from "@/market-clock/market-clock";
import {
  type DarkfanxingClient,
  type Fetched,
  redactKey,
  type TitleMeta,
} from "@/sources/darkfanxing";
import type { FinMindClient } from "@/sources/finmind";
import type { TwseClient } from "@/sources/twse";
import { generateBriefings } from "./briefings";
import { reparseSnapshots } from "./reparse";
import { shiftDate } from "./shift-date";
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
  /** Milliseconds on a monotonic-enough clock, for the run's time budget; defaults to `Date.now`. */
  clock?: () => number;
  /** Overrides `BRIEFING_RUN_BUDGET_MS` (tests). */
  briefingRunBudgetMs?: number;
};

export type IngestionAction = {
  name: string;
  status: "done" | "skipped" | "failed";
  detail?: string;
};

/** `phase` is null only when the trading calendar could not be loaded (see the `calendar` action). */
export type IngestionReport = { phase: MarketPhase | null; actions: IngestionAction[] };

export type Outcome = Omit<IngestionAction, "name">;

export type Attempt<T> = { ok: true; value: T } | { ok: false };

export type Recorder = {
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
  const startedAt = (deps.clock ?? Date.now)();
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
  await generateBriefings(deps, recorder, { expected, holidays, startedAt });
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
