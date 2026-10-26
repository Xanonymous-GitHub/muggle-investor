CREATE TABLE "rate_limit_window" (
	"source" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"used" integer NOT NULL,
	CONSTRAINT "rate_limit_window_used_check" CHECK ("rate_limit_window"."used" >= 0)
);
