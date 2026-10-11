import type { Logger } from "pino";
import type { Db } from "@/db/client";
import { getHolidays, replaceHolidays } from "@/db/repositories/calendar";
import { latestPriceDate, upsertCorporateActions, upsertPriceBars } from "@/db/repositories/prices";
import { hasSnapshot, type NewSnapshot, saveSnapshot } from "@/db/repositories/snapshots";
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
import { TRACKED_SYMBOLS } from "./tracked-symbols";

export type IngestionDeps = {
  db: Db;
  darkfanxing: DarkfanxingClient;
  /** Scrubbed from stored raw HTML and from every report detail; never persisted or returned. */
  darkfanxingKey: string;
  finmind: FinMindClient;
  twse: TwseClient;
  now: Date;
  logger: Logger;
};

export type IngestionAction = {
  name: string;
  status: "done" | "skipped" | "failed";
  detail?: string;
};

export type IngestionReport = { phase: MarketPhase; actions: IngestionAction[] };

type Outcome = Omit<IngestionAction, "name">;

/** Bumped whenever a darkfanxing parser changes the shape stored in `parsed`. */
const PARSER_VERSION = 1;
/** First date requested when a symbol has no stored bars yet. */
const BACKFILL_START = "2010-01-01";
/** Dividend results can be published after the ex-date; re-fetching a window makes that safe (upserts are idempotent). */
const CORPORATE_ACTION_LOOKBACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const shiftDate = (date: string, days: number): string =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * One scheduled ingestion pass. Fetches what the current market phase calls for and stores it
 * idempotently; each step is reported separately and a failing step never aborts the others.
 * Darkfanxing requests per run: 1 intraday/settling, at most 2 otherwise.
 */
export async function runIngestion(deps: IngestionDeps): Promise<IngestionReport> {
  const { db, now, logger } = deps;
  const scrub = (text: string) => redactKey(text, deps.darkfanxingKey, "***");
  const actions: IngestionAction[] = [];

  const record = async (name: string, step: () => Promise<Outcome>): Promise<void> => {
    let outcome: Outcome;
    try {
      outcome = await step();
    } catch (error) {
      outcome = { status: "failed", detail: errorMessage(error) };
    }
    const action: IngestionAction = {
      name,
      status: outcome.status,
      ...(outcome.detail !== undefined && { detail: scrub(outcome.detail) }),
    };
    actions.push(action);
    if (action.status === "failed") logger.error(action, "ingestion action failed");
    else logger.info(action, "ingestion action");
  };

  const today = toTaipei(now).date;
  const year = Number(today.slice(0, 4));
  await record("holidays", () => refreshHolidays(deps, year));
  // The previous year matters for look-backs across New Year.
  const holidays = [...(await getHolidays(db, year - 1)), ...(await getHolidays(db, year))];
  const phase = marketPhase(now, holidays);

  if (phase === "intraday" || phase === "settling") {
    await record("sector_board", async () => {
      const { row, inserted } = await store(deps, scrub, "sector_board", () =>
        deps.darkfanxing.fetchSectorBoard(),
      );
      return parseFailure(row) ?? { status: "done", detail: summarize(row, inserted) };
    });
    return { phase, actions };
  }

  // post-close, closed-day, pre-open: catch up on the last settled session, then prices.
  const expected = lastSettledTradeDate(now, holidays);
  await record("digest", () =>
    catchUp(deps, scrub, "digest", expected, () => deps.darkfanxing.fetchDigest()),
  );
  await record("sector_board", () =>
    catchUp(deps, scrub, "sector_board", expected, () => deps.darkfanxing.fetchSectorBoard()),
  );
  for (const symbol of TRACKED_SYMBOLS) {
    await ingestPrices(deps, record, symbol, expected, today);
  }
  return { phase, actions };
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

/** Fetches the closed snapshot for `expected` unless it is already stored. */
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
  return { status: "done", detail: summarize(row, inserted) };
}

/** Fetches one report and saves it (key scrubbed), dated by its content. */
async function store<T extends TitleMeta>(
  { db, logger }: IngestionDeps,
  scrub: (text: string) => string,
  kind: "digest" | "sector_board",
  fetch: () => Promise<Fetched<T>>,
): Promise<{ row: NewSnapshot; inserted: boolean }> {
  const fetched = await fetch();
  const dated: TitleMeta | null = fetched.parsed ?? fetched.meta;
  const row: NewSnapshot = {
    kind,
    groupName: null,
    tradeDate: dated?.tradeDate ?? toTaipei(fetched.fetchedAt).date,
    asOf: dated?.asOf ?? null,
    session: dated?.session ?? "unknown",
    capturedAt: fetched.fetchedAt,
    rawHtml: scrub(fetched.raw),
    parsed: fetched.parsed,
    parseError: fetched.parseError === null ? null : scrub(fetched.parseError),
    parserVersion: PARSER_VERSION,
  };
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
  record: (name: string, step: () => Promise<Outcome>) => Promise<void>,
  symbol: string,
  expected: string,
  today: string,
): Promise<void> {
  const latest = await latestPriceDate(db, symbol);
  if (latest !== null && latest >= expected) {
    const upToDate = async (): Promise<Outcome> => ({
      status: "skipped",
      detail: `up to date (${latest})`,
    });
    await record(`prices:${symbol}`, upToDate);
    await record(`corporate_actions:${symbol}`, upToDate);
    return;
  }

  const from = latest === null ? BACKFILL_START : shiftDate(latest, 1);
  await record(`prices:${symbol}`, async () => {
    const bars = await finmind.fetchPrices(symbol, from, today);
    await upsertPriceBars(db, bars);
    return { status: "done", detail: `${bars.length} bars from ${from}` };
  });

  const actionsFrom =
    latest === null ? BACKFILL_START : shiftDate(from, -CORPORATE_ACTION_LOOKBACK_DAYS);
  await record(`corporate_actions:${symbol}`, async () => {
    const corporateActions = await finmind.fetchCorporateActions(symbol, actionsFrom);
    await upsertCorporateActions(db, corporateActions);
    return { status: "done", detail: `${corporateActions.length} actions from ${actionsFrom}` };
  });
}
