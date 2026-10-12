CREATE TYPE "public"."briefing_kind" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."briefing_lens" AS ENUM('beginner', 'pro');--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "briefing_kind" NOT NULL,
	"period_key" text NOT NULL,
	"lens" "briefing_lens" NOT NULL,
	"prompt_version" integer NOT NULL,
	"model" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefings_period_key_check" CHECK (("briefings"."kind" = 'daily' and "briefings"."period_key" ~ '^\d{4}-\d{2}-\d{2}$') or ("briefings"."kind" = 'weekly' and "briefings"."period_key" ~ '^\d{4}-W\d{2}$'))
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "briefings_kind_period_lens_idx" ON "briefings" USING btree ("kind","period_key","lens");