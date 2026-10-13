import { hasBriefing, listBriefings } from "@/db/repositories/briefings";
import { getClosedSnapshot, listClosedSnapshots } from "@/db/repositories/snapshots";
import type { WeeklyDay } from "@/insight/facts-weekly";
import { generateDailyBriefing } from "@/insight/generate-daily";
import { generateWeeklyBriefing } from "@/insight/generate-weekly";
import { LENSES, type Lens } from "@/insight/lens";
import type { Llm } from "@/insight/llm";
import type { ProduceDeps, ProduceResult } from "@/insight/pipeline";
import { DAILY_PROMPT_VERSION } from "@/insight/prompts/daily";
import { WEEKLY_PROMPT_VERSION } from "@/insight/prompts/weekly";
import { isoWeekKey, isWeekComplete, weekRange } from "@/insight/week";
import type { DigestSnapshot, SectorBoard } from "@/sources/darkfanxing";
import { digestSnapshotSchema, sectorBoardSchema } from "@/sources/darkfanxing/schemas";
import type { MarketHoliday } from "@/sources/twse";
import type { IngestionDeps, Outcome, Recorder } from "./run-ingestion";
import { shiftDate } from "./shift-date";

/** Earlier closed digests briefed per lens per run, and how far back they may lie from the settled date. */
const CATCH_UP_MAX_DATES = 4;
const CATCH_UP_WINDOW_DAYS = 14;

/**
 * Wall time, from the start of the run, after which no further briefing action starts. The cron
 * route allows 300 s (`maxDuration`); one LLM call with repairs can take a while, so the last
 * action starts with about 30 s to spare.
 */
export const BRIEFING_RUN_BUDGET_MS = 270_000;

const BUDGET_EXHAUSTED: Outcome = { status: "skipped", detail: "run time budget exhausted" };

const LLM_UNAVAILABLE: Outcome = {
  status: "skipped",
  detail: "LLM unavailable earlier in this run",
};

const outcomeOf = (result: ProduceResult): Outcome => {
  if (result.status === "saved") return { status: "done" };
  if (result.status === "skipped") return { status: "skipped", detail: "already stored" };
  return { status: "skipped", detail: `rejected: ${(result.reasons ?? []).join("; ")}` };
};

/**
 * Stored-data readers for one run. Invalid stored rows are logged at `warn`, each at most once
 * per run (the same row is read for both lenses and by the catch-up scan).
 */
function createReaders({ db, logger }: Pick<IngestionDeps, "db" | "logger">) {
  const logged = new Set<string>();
  const warnOnce = (key: string, fields: object, message: string) => {
    if (logged.has(key)) return;
    logged.add(key);
    logger.warn(fields, message);
  };

  const validDigest = (parsed: unknown, date: string): DigestSnapshot | null => {
    const result = digestSnapshotSchema.safeParse(parsed);
    if (result.success) return result.data;
    warnOnce(
      `digest:${date}`,
      { date, error: result.error.message },
      "stored digest no longer validates",
    );
    return null;
  };

  return {
    validDigest,

    /** The parsed closed digest of `date`, re-validated; null when missing, unparsed or invalid. */
    async digest(date: string): Promise<DigestSnapshot | null> {
      const row = await getClosedSnapshot(db, "digest", date);
      return row ? validDigest(row.parsed, date) : null;
    },

    /** The closed board of `date` when it validates for that date, else null (a missing board only thins the facts). */
    async board(date: string): Promise<SectorBoard | null> {
      const row = await getClosedSnapshot(db, "sector_board", date);
      if (!row) return null;
      const result = sectorBoardSchema.safeParse(row.parsed);
      if (result.success && result.data.tradeDate === date) return result.data;
      warnOnce(
        `board:${date}`,
        { date },
        "stored sector board does not validate for its date; briefing without it",
      );
      return null;
    },
  };
}

type Readers = ReturnType<typeof createReaders>;

/**
 * Daily and weekly briefings for both lenses, each its own recorded action so one failure never
 * stops the rest. Order: the settled date's daily for every lens (the newest content first), then
 * per lens up to 4 earlier closed digests that lack a daily (oldest first), then the weeklies.
 *
 * The first thrown error from an LLM call (not a validator `rejected`) trips a per-run breaker:
 * every later action that would call the LLM is skipped without calling it. Likewise, once
 * `BRIEFING_RUN_BUDGET_MS` has passed since `startedAt` (the run's start), every remaining
 * briefing action is skipped before it starts; the next run picks them up.
 */
export async function generateBriefings(
  deps: IngestionDeps,
  { record, attempt }: Recorder,
  {
    expected,
    holidays,
    startedAt,
  }: { expected: string; holidays: MarketHoliday[]; startedAt: number },
): Promise<void> {
  const { db, logger, now } = deps;
  const readers = createReaders(deps);
  const clock = deps.clock ?? Date.now;
  const budget = deps.briefingRunBudgetMs ?? BRIEFING_RUN_BUDGET_MS;
  let outOfTime = false;
  /** True once the budget is spent; checked before each briefing action starts. */
  const budgetSpent = (): boolean => {
    outOfTime ||= clock() - startedAt >= budget;
    return outOfTime;
  };
  /** Records `name`, skipping it without running `step` once the budget is spent. */
  const recordInBudget = (name: string, step: () => Promise<Outcome>) =>
    record(name, async () => (budgetSpent() ? BUDGET_EXHAUSTED : step()));

  let llmDown = false;
  const llm: Llm = {
    modelId: deps.llm.modelId,
    async generateObject(req) {
      try {
        return await deps.llm.generateObject(req);
      } catch (error) {
        llmDown = true;
        throw error;
      }
    },
  };
  const produceDeps: ProduceDeps = { db, llm, logger, now: () => now };

  const dailyFor = async (lens: Lens, date: string): Promise<Outcome> => {
    if (await hasBriefing(db, "daily", date, lens, DAILY_PROMPT_VERSION)) {
      return { status: "skipped", detail: "already stored" };
    }
    if (llmDown) return LLM_UNAVAILABLE;
    const digest = await readers.digest(date);
    if (!digest) return { status: "skipped", detail: `no parsed closed digest for ${date}` };
    const board = await readers.board(date);
    return outcomeOf(await generateDailyBriefing(produceDeps, { digest, board, lens }));
  };

  for (const lens of LENSES) {
    await recordInBudget(`briefing:daily:${lens}`, () => dailyFor(lens, expected));
  }
  for (const lens of LENSES) {
    if (budgetSpent()) break;
    const earlier = await attempt([`briefing:daily:${lens}:catch-up`], () =>
      datesMissingDaily(deps, readers, lens, expected),
    );
    if (!earlier.ok) continue;
    for (const date of earlier.value) {
      await recordInBudget(`briefing:daily:${lens}:${date}`, () => dailyFor(lens, date));
    }
  }

  // `isWeekComplete` is only true for the week holding its latest close, so ask about the week of
  // the settled date with that date as the latest close; a week already past is never revisited.
  const weekKey = isoWeekKey(expected);
  if (!isWeekComplete(weekKey, holidays, expected)) return;
  for (const lens of LENSES) {
    await recordInBudget(`briefing:weekly:${lens}`, async () => {
      if (await hasBriefing(db, "weekly", weekKey, lens, WEEKLY_PROMPT_VERSION)) {
        return { status: "skipped", detail: "already stored" };
      }
      if (llmDown) return LLM_UNAVAILABLE;
      // A stored weekly is never replaced at the same prompt version, so do not write it without
      // the week's final day (and that day's summary): wait for a later run to supply them.
      const days = await weeklyDays(deps, readers, weekKey, lens);
      if (!days.some((day) => day.digest.tradeDate === expected)) {
        return { status: "skipped", detail: `waiting for ${expected} digest` };
      }
      if (!(await hasBriefing(db, "daily", expected, lens, DAILY_PROMPT_VERSION))) {
        return { status: "skipped", detail: `waiting for ${expected} daily briefing` };
      }
      return outcomeOf(await generateWeeklyBriefing(produceDeps, { weekKey, days, lens }));
    });
  }
}

/**
 * The up-to-4 most recent closed, parsed, valid digests before `expected` (within 14 days) that
 * lack a daily briefing in `lens`, oldest first.
 */
async function datesMissingDaily(
  { db }: IngestionDeps,
  readers: Readers,
  lens: Lens,
  expected: string,
): Promise<string[]> {
  const rows = await listClosedSnapshots(
    db,
    "digest",
    shiftDate(expected, -CATCH_UP_WINDOW_DAYS),
    shiftDate(expected, -1),
    { parsedOnly: true },
  );
  const missing: string[] = [];
  for (const row of rows) {
    if (readers.validDigest(row.parsed, row.tradeDate) === null) continue;
    if (!(await hasBriefing(db, "daily", row.tradeDate, lens, DAILY_PROMPT_VERSION))) {
      missing.push(row.tradeDate);
    }
  }
  return missing.slice(-CATCH_UP_MAX_DATES);
}

/** The week's closed digests with each day's same-lens daily summary (null when it has none). */
async function weeklyDays(
  { db }: IngestionDeps,
  readers: Readers,
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
    const digest = readers.validDigest(row.parsed, row.tradeDate);
    if (digest) days.push({ digest, dailySummary: summaries.get(row.tradeDate) ?? null });
  }
  return days;
}
