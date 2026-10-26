import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type SnapshotSession = "closed" | "intraday" | "unknown";

export const snapshotKindEnum = pgEnum("snapshot_kind", [
  "digest",
  "sector_board",
  "sector_detail",
]);

/**
 * Raw + parsed upstream snapshots. `as_of` is NULL for closed digests, and Postgres treats NULLs
 * as distinct in unique indexes, so the dedupe index coalesces both nullable columns to ''.
 * `session` is part of the key so an earlier unknown/intraday row for a date never blocks the
 * closed snapshot of that date (a closed digest has no as_of to tell them apart).
 */
export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: snapshotKindEnum("kind").notNull(),
    groupName: text("group_name"),
    tradeDate: date("trade_date", { mode: "string" }).notNull(),
    asOf: text("as_of"),
    session: text("session").$type<SnapshotSession>().notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
    rawHtml: text("raw_html").notNull(),
    parsed: jsonb("parsed"),
    parseError: text("parse_error"),
    parserVersion: integer("parser_version").notNull(),
    /** Parser version of the last re-parse that failed or collided; keeps such rows from being rescanned until the parser changes. */
    reparseAttemptedVersion: integer("reparse_attempted_version"),
  },
  (t) => [
    uniqueIndex("market_snapshots_dedupe_idx").on(
      t.kind,
      sql`coalesce(${t.groupName}, '')`,
      t.tradeDate,
      sql`coalesce(${t.asOf}, '')`,
      t.session,
    ),
    index("market_snapshots_kind_captured_idx").on(t.kind, t.capturedAt),
    check("market_snapshots_session_check", sql`${t.session} in ('closed', 'intraday', 'unknown')`),
  ],
);

export const priceBars = pgTable(
  "price_bars",
  {
    symbol: text("symbol").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: bigint("volume", { mode: "number" }).notNull(),
    /** Traded value in TWD (FinMind Trading_money); NULL for rows stored before it was kept. */
    turnover: doublePrecision("turnover"),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

/**
 * Listed ETFs from the instrument list. `history_checked_at` is set once the price history has
 * been backfilled for the symbol, so the backfill is not repeated; a refresh never clears it.
 */
export const etfUniverse = pgTable("etf_universe", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  industry: text("industry").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  historyCheckedAt: timestamp("history_checked_at", { withTimezone: true, mode: "date" }),
});

export const corporateActionKindEnum = pgEnum("corporate_action_kind", ["dividend", "split"]);

export const corporateActions = pgTable(
  "corporate_actions",
  {
    symbol: text("symbol").notNull(),
    exDate: date("ex_date", { mode: "string" }).notNull(),
    kind: corporateActionKindEnum("kind").notNull(),
    beforePrice: doublePrecision("before_price").notNull(),
    afterPrice: doublePrecision("after_price").notNull(),
    cashDividend: doublePrecision("cash_dividend"),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.exDate, t.kind] })],
);

export const marketHolidays = pgTable("market_holidays", {
  date: date("date", { mode: "string" }).primaryKey(),
  name: text("name").notNull(),
  isTradingDay: boolean("is_trading_day").notNull(),
});

export const briefingKindEnum = pgEnum("briefing_kind", ["daily", "weekly"]);
export const briefingLensEnum = pgEnum("briefing_lens", ["beginner", "pro"]);

/**
 * LLM-written briefings, generated once and shared by all users. `period_key` is `YYYY-MM-DD` for
 * daily and `YYYY-Www` for weekly; both sort correctly as strings. A higher `prompt_version`
 * replaces the stored row (see `saveBriefing`).
 */
export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: briefingKindEnum("kind").notNull(),
    periodKey: text("period_key").notNull(),
    lens: briefingLensEnum("lens").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    model: text("model").notNull(),
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("briefings_kind_period_lens_idx").on(t.kind, t.periodKey, t.lens),
    check(
      "briefings_period_key_check",
      sql`(${t.kind} = 'daily' and ${t.periodKey} ~ '^\\d{4}-\\d{2}-\\d{2}$') or (${t.kind} = 'weekly' and ${t.periodKey} ~ '^\\d{4}-W\\d{2}$')`,
    ),
  ],
);

/**
 * LLM-written explanation of the allocation for one risk level and lens, shared by all users. One
 * row per `(level, lens)`; `period_key` is the ISO week (`YYYY-Www`) it was generated for. A higher
 * `prompt_version`, the same version with a later week, or the same version and week with a
 * different `facts_fingerprint` (the run's structure changed within the week) replaces it (see
 * `savePlanExplanation`).
 */
export const planExplanations = pgTable(
  "plan_explanations",
  {
    level: smallint("level").notNull(),
    lens: briefingLensEnum("lens").notNull(),
    periodKey: text("period_key").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    model: text("model").notNull(),
    content: jsonb("content").notNull(),
    /** sha256 of the reference run's structural facts (level, weights, funds, warnings, starts). */
    factsFingerprint: text("facts_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.level, t.lens] }),
    check("plan_explanations_level_check", sql`${t.level} between 1 and 5`),
    check("plan_explanations_period_key_check", sql`${t.periodKey} ~ '^\\d{4}-W\\d{2}$'`),
  ],
);

/** One row per LLM call, for token/cost tracking. Token counts are null when the provider omits them. */
export const llmUsage = pgTable("llm_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Per-person (hashed subject) daily Ask quota and token totals, keyed by Taipei date.
 * Counters only: no message content is ever stored.
 */
export const askUsage = pgTable(
  "ask_usage",
  {
    subject: text("subject").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    messages: integer("messages").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    /** Messages given back today after a server- or provider-side failure; capped per day. */
    refunds: integer("refunds").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.subject, t.day] }),
    check("ask_usage_messages_check", sql`${t.messages} >= 0`),
    check("ask_usage_refunds_check", sql`${t.refunds} >= 0`),
  ],
);

/**
 * One fixed-window request budget per upstream, shared by every app instance (`source` names the
 * upstream). The window opens on the first take after the previous one ended; `window_start` is
 * the database clock, so instances with different clocks still agree on the window.
 */
export const rateLimitWindow = pgTable(
  "rate_limit_window",
  {
    source: text("source").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    used: integer("used").notNull(),
  },
  (t) => [check("rate_limit_window_used_check", sql`${t.used} >= 0`)],
);
