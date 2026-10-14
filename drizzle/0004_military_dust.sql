CREATE TABLE "etf_universe" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"market" text NOT NULL,
	"industry" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"history_checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "price_bars" ADD COLUMN "turnover" double precision;