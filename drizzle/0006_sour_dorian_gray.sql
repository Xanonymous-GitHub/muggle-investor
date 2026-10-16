CREATE TABLE "ask_usage" (
	"subject" text NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_usage_subject_day_pk" PRIMARY KEY("subject","day"),
	CONSTRAINT "ask_usage_messages_check" CHECK ("ask_usage"."messages" >= 0)
);
