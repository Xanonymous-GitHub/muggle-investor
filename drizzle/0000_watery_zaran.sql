CREATE TYPE "public"."corporate_action_kind" AS ENUM('dividend', 'split');--> statement-breakpoint
CREATE TYPE "public"."snapshot_kind" AS ENUM('digest', 'sector_board', 'sector_detail');--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"symbol" text NOT NULL,
	"ex_date" date NOT NULL,
	"kind" "corporate_action_kind" NOT NULL,
	"before_price" double precision NOT NULL,
	"after_price" double precision NOT NULL,
	"cash_dividend" double precision,
	CONSTRAINT "corporate_actions_symbol_ex_date_kind_pk" PRIMARY KEY("symbol","ex_date","kind")
);
--> statement-breakpoint
CREATE TABLE "market_holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_trading_day" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "snapshot_kind" NOT NULL,
	"group_name" text,
	"trade_date" date NOT NULL,
	"as_of" text,
	"session" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"raw_html" text NOT NULL,
	"parsed" jsonb,
	"parse_error" text,
	"parser_version" integer NOT NULL,
	CONSTRAINT "market_snapshots_session_check" CHECK ("market_snapshots"."session" in ('closed', 'intraday', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "price_bars" (
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" bigint NOT NULL,
	CONSTRAINT "price_bars_symbol_date_pk" PRIMARY KEY("symbol","date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "market_snapshots_dedupe_idx" ON "market_snapshots" USING btree ("kind",coalesce("group_name", ''),"trade_date",coalesce("as_of", ''));--> statement-breakpoint
CREATE INDEX "market_snapshots_kind_captured_idx" ON "market_snapshots" USING btree ("kind","captured_at");