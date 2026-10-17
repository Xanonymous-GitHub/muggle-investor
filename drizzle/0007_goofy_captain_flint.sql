ALTER TABLE "ask_usage" ADD COLUMN "refunds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_usage" ADD CONSTRAINT "ask_usage_refunds_check" CHECK ("ask_usage"."refunds" >= 0);