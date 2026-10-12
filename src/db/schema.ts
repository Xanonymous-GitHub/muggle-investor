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
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

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
