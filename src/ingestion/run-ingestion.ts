import type { Logger } from "pino";
import type { Db } from "@/db/client";
import { getHolidays, replaceHolidays } from "@/db/repositories/calendar";
import {
  type EtfUniverseRow,
  listEtfUniverse,
  markHistoryChecked,
} from "@/db/repositories/etf-universe";
import {
  earliestPriceDate,
  latestPriceDate,
  upsertCorporateActions,
  upsertPriceBars,
} from "@/db/repositories/prices";
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
import { createLlmBreaker, generateBriefings } from "./briefings";
import { refreshEtfUniverse } from "./etf-universe";
import { generatePlanExplanations } from "./plan-explanations";
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
  /** Writes the briefings and plan explanations; an outage only fails or skips those actions. */
  llm: Llm;
  now: Date;
  logger: Logger;
  /** Milliseconds on a monotonic-enough clock, for the run's time budget; defaults to `Date.now`. */
  clock?: () => number;
  /** Overrides `BRIEFING_RUN_BUDGET_MS`, which the plan explanations share (tests). */
  briefingRunBudgetMs?: number;
  /** Overrides `PRICE_RUN_BUDGET_MS` (tests). */
  priceRunBudgetMs?: number;
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

/** First date requested when a symbol has no stored bars yet (0050 lists on 2003-06-30). */
const BACKFILL_START = "2003-01-01";
/** Stored history starting later than `BACKFILL_START` plus this many days gets one gap fetch. */
const HISTORY_GAP_TOLERANCE_DAYS = 31;
/** First-time and gap backfills per run (3 FinMind requests each); the rest wait for later runs. */
export const MAX_SYMBOL_BACKFILLS_PER_RUN = 3;
/**
 * Wall time, from the start of the run, after which no further symbol's price top-up starts (a
 * start gate like `BRIEFING_RUN_BUDGET_MS`). A top-up is 3 FinMind requests, so refreshing all 21
 * symbols is 63-73 requests, about 6-7 minutes at FinMind's 10 requests a minute: more than one
 * run's 300 s. Symbols not started in time are skipped and topped up by the next post-close run;
 * the loop runs stalest first so none starves, and the briefings keep the rest of the run.
 */
export const PRICE_RUN_BUDGET_MS = 150_000;
const PRICE_BUDGET_EXHAUSTED: Outcome = { status: "skipped", detail: "price budget exhausted" };
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
  // and the LLM steps last (briefings, then the weekly plan explanations): an LLM outage (up to
  // its timeout per call) must not delay prices.
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
  // Before the prices: the gap check below reads the universe this refresh keeps current.
  await record("etf_universe", () => refreshEtfUniverse(deps));
  const universe = await attempt(["prices:history"], async () => {
    const rows = await listEtfUniverse(db);
    return new Map(rows.map((row) => [row.symbol, row]));
  });
  const backfills = { remaining: MAX_SYMBOL_BACKFILLS_PER_RUN };
  const clock = deps.clock ?? Date.now;
  const priceBudget = deps.priceRunBudgetMs ?? PRICE_RUN_BUDGET_MS;
  for (const { symbol, latest } of await staleFirst(deps, recorder)) {
    if (clock() - startedAt >= priceBudget) {
      await record(`prices:${symbol}`, async () => PRICE_BUDGET_EXHAUSTED);
      await record(`corporate_actions:${symbol}`, async () => PRICE_BUDGET_EXHAUSTED);
      continue;
    }
    const args = { symbol, latest, expected, today, backfills };
    const hadBars = await ingestPrices(deps, recorder, args);
    // A first backfill already starts at BACKFILL_START, so only symbols with older bars need a gap check.
    if (hadBars && universe.ok) {
      await ingestHistory(deps, recorder, { symbol, row: universe.value.get(symbol), backfills });
    }
  }
  // One breaker per run: an LLM outage seen by the briefings also skips the plan explanations.
  const breaker = createLlmBreaker(deps.llm);
  await generateBriefings(deps, recorder, { expected, holidays, startedAt, breaker });
  // Weekly content: only after a session closes (R-E8), not on every closed-day or pre-open run,
  // where a rejected pair would be retried every few minutes.
  if (phase === "post-close")
    await generatePlanExplanations(deps, recorder, { startedAt, breaker });
  return { phase, actions };
}

/**
 * The tracked symbols with their newest stored bar date, oldest first (no bars first), ties in
 * category order. A failed read is recorded as failed for that symbol, which is left out.
 */
async function staleFirst(
  { db }: IngestionDeps,
  { attempt }: Recorder,
): Promise<{ symbol: string; latest: string | null }[]> {
  const symbols: { symbol: string; latest: string | null }[] = [];
  for (const symbol of TRACKED_SYMBOLS) {
    const stored = await attempt([`prices:${symbol}`, `corporate_actions:${symbol}`], () =>
      latestPriceDate(db, symbol),
    );
    if (stored.ok) symbols.push({ symbol, latest: stored.value });
  }
  // Array.prototype.sort is stable, so equal dates keep category order.
  return symbols.sort((a, b) => {
    if (a.latest === b.latest) return 0;
    if (a.latest === null) return -1;
    if (b.latest === null) return 1;
    return a.latest < b.latest ? -1 : 1;
  });
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

type BackfillBudget = { remaining: number };

const DEFERRED: Outcome = { status: "skipped", detail: "backfill deferred" };
const deferred = async (): Promise<Outcome> => DEFERRED;

const historyAction = (symbol: string) => `prices:${symbol}:history`;

/** Takes one backfill slot; false once this run's budget is spent. */
function takeBackfill(budget: BackfillBudget): boolean {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
}

/**
 * Tops a symbol's prices and corporate actions up to `expected`. A symbol with no bars gets its
 * first backfill from `BACKFILL_START` if the run's budget allows; otherwise both actions are
 * deferred. Top-ups of symbols that already have bars are not capped. Returns whether the symbol
 * had stored bars before this run.
 */
async function ingestPrices(
  { db, finmind, now }: IngestionDeps,
  { record }: Recorder,
  args: {
    symbol: string;
    /** The symbol's newest stored bar date, null when it has none. */
    latest: string | null;
    expected: string;
    today: string;
    backfills: BackfillBudget;
  },
): Promise<boolean> {
  const { symbol, latest, expected, today, backfills } = args;
  const pricesAction = `prices:${symbol}`;
  const corporateActionsAction = `corporate_actions:${symbol}`;
  if (latest !== null && latest >= expected) {
    const upToDate = async (): Promise<Outcome> => ({
      status: "skipped",
      detail: `up to date (${latest})`,
    });
    await record(pricesAction, upToDate);
    await record(corporateActionsAction, upToDate);
    return true;
  }
  if (latest === null && !takeBackfill(backfills)) {
    await record(pricesAction, deferred);
    await record(corporateActionsAction, deferred);
    return false;
  }

  const from = latest === null ? BACKFILL_START : shiftDate(latest, 1);
  let pricesOk = false;
  await record(pricesAction, async () => {
    const bars = await finmind.fetchPrices(symbol, from, today);
    await upsertPriceBars(db, bars);
    pricesOk = true;
    return { status: "done", detail: `${bars.length} bars from ${from}` };
  });

  const actionsFrom =
    latest === null ? BACKFILL_START : shiftDate(from, -CORPORATE_ACTION_LOOKBACK_DAYS);
  await record(corporateActionsAction, async () => {
    const corporateActions = await finmind.fetchCorporateActions(symbol, actionsFrom);
    await upsertCorporateActions(db, corporateActions);
    // A complete first backfill already covers the history window; no gap fetch is needed later.
    if (latest === null && pricesOk) await markHistoryChecked(db, symbol, now);
    return { status: "done", detail: `${corporateActions.length} actions from ${actionsFrom}` };
  });
  return latest !== null;
}

/**
 * One-time gap fetch for a symbol whose stored bars start well after `BACKFILL_START` (stored
 * before the backfill start moved earlier). Needs an unchecked universe row, so it waits until
 * the universe has been refreshed. Marked checked once both fetches succeed, even with no bars:
 * a symbol listed after `BACKFILL_START` has nothing earlier and is never refetched.
 */
async function ingestHistory(
  { db, finmind, now }: IngestionDeps,
  { record, attempt }: Recorder,
  args: { symbol: string; row: EtfUniverseRow | undefined; backfills: BackfillBudget },
): Promise<void> {
  const { symbol, row, backfills } = args;
  if (!row || row.historyCheckedAt !== null) return;
  const name = historyAction(symbol);
  const stored = await attempt([name], () => earliestPriceDate(db, symbol));
  if (!stored.ok) return;
  const earliest = stored.value;
  if (earliest === null || earliest <= shiftDate(BACKFILL_START, HISTORY_GAP_TOLERANCE_DAYS)) {
    return;
  }
  if (!takeBackfill(backfills)) {
    await record(name, deferred);
    return;
  }
  await record(name, async () => {
    const to = shiftDate(earliest, -1);
    const bars = await finmind.fetchPrices(symbol, BACKFILL_START, to);
    const corporateActions = await finmind.fetchCorporateActions(symbol, BACKFILL_START);
    await upsertPriceBars(db, bars);
    await upsertCorporateActions(db, corporateActions);
    await markHistoryChecked(db, symbol, now);
    return {
      status: "done",
      detail: `${bars.length} bars ${BACKFILL_START}..${to}, ${corporateActions.length} actions`,
    };
  });
}
