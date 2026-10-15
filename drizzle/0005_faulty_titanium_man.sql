CREATE TABLE "plan_explanations" (
	"level" smallint NOT NULL,
	"lens" "briefing_lens" NOT NULL,
	"period_key" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"model" text NOT NULL,
	"content" jsonb NOT NULL,
	"facts_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_explanations_level_lens_pk" PRIMARY KEY("level","lens"),
	CONSTRAINT "plan_explanations_level_check" CHECK ("plan_explanations"."level" between 1 and 5),
	CONSTRAINT "plan_explanations_period_key_check" CHECK ("plan_explanations"."period_key" ~ '^\d{4}-W\d{2}$')
);
