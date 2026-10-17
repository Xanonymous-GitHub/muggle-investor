/**
 * Runs the Ask question set through `streamAnswer` in-process, against the real database and the
 * configured LLM endpoint, and writes a Markdown transcript for a person to read and grade.
 *
 * Usage:
 *   bun run ask:eval
 *   bun run ask:eval -- --lens pro --limit 5
 *   bun run ask:eval -- --id market-down-beginner
 *
 * The transcript goes to ./ask-eval-<YYYY-MM-DD>-<HHMMSS>.md (Taipei time, git-ignored): per
 * question the lens, the answer text, tool names (no arguments or results), how many tool calls
 * the privacy filter blocked, the notices and the number check, and an unticked rubric checklist.
 * It bypasses the HTTP session and daily quota, uses a fixed eval subject (`ask-eval`) for the
 * token totals, and a SAMPLE profile (below), never a real person's data. The calls cost real LLM
 * tokens and write usage rows (llm_usage, and ask_usage under subject `ask-eval`) to the database
 * DATABASE_URL points at, like any Ask answer. Failures
 * print only the error class and a fixed category, never an error message.
 * Exits 1 on bad arguments, an invalid environment or when every question failed.
 */
import { writeFile } from "node:fs/promises";
import { AskUnavailableError, streamAnswer } from "@/ask/ask-service";
import { ASK_QUESTIONS, type AskQuestion } from "@/ask/eval/questions";
import {
  type EvalEntry,
  type EvalOutcome,
  formatTranscript,
  parseAnswerStream,
  transcriptFileName,
} from "@/ask/eval/transcript";
import { ASK_PROMPT_VERSION } from "@/ask/prompts/ask";
import { type AskRequest, askRequestSchema } from "@/ask/schema";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { toTaipei } from "@/market-clock/market-clock";
import { describeFailure } from "@/server/describe-failure";
import { getAskModel, getDb } from "@/server/services";

/** Not a real person: one plan request and two holdings, so profile-aware answers can be read. */
const SAMPLE_PROFILE: AskRequest["profile"] = {
  plan: {
    answers: {
      age: "age-30-39",
      horizon: "horizon-5-10y",
      income: "income-stable",
      reserve: "reserve-3-6m",
      loss: "loss-hold",
    },
    lump: 600_000,
    monthly: 15_000,
    monthlyExpenses: 30_000,
    existingReserve: 90_000,
  },
  holdings: [
    { symbol: "0050", amount: 300_000, quantity: 2000 },
    { symbol: "2330", amount: 450_000, quantity: 500 },
  ],
  memory: ["兩年內想買房"],
};

/** The fixed subject the token totals of eval runs are recorded under. */
const EVAL_SUBJECT = "ask-eval";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

type Options = { lens?: "beginner" | "pro"; id?: string; limit?: number };

function parseArgs(argv: string[]): Options {
  const options: Options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--") continue;
    if (value === undefined) fail(`missing value for ${flag}`);
    if (flag === "--lens") {
      if (value !== "beginner" && value !== "pro") fail('--lens must be "beginner" or "pro"');
      options.lens = value;
    } else if (flag === "--id") {
      options.id = value;
    } else if (flag === "--limit") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) fail("--limit must be a positive integer");
      options.limit = n;
    } else {
      fail(`unknown option ${flag}; use --lens, --id or --limit`);
    }
    i++;
  }
  return options;
}

function selectQuestions(options: Options): AskQuestion[] {
  let questions = ASK_QUESTIONS.filter(
    (q) =>
      (options.lens === undefined || q.lens === options.lens) &&
      (options.id === undefined || q.id === options.id),
  );
  if (options.limit !== undefined) questions = questions.slice(0, options.limit);
  if (questions.length === 0) fail("no question matches the options");
  return questions;
}

async function run(questions: AskQuestion[]): Promise<number> {
  const env = getEnv();
  const db = getDb();
  const { model, modelId } = getAskModel();
  console.log(
    `model ${modelId}; ${questions.length} question(s); voice ${env.ASK_VOICE}; tools ${env.ASK_TOOLS}`,
  );

  async function ask(question: AskQuestion): Promise<EvalOutcome> {
    const request = askRequestSchema.parse({
      lens: question.lens,
      messages: [{ role: "user", content: question.text }],
      profile: SAMPLE_PROFILE,
    });
    try {
      const response = await streamAnswer(
        { db, model, modelId, env, processEnv: process.env, now: new Date(), logger },
        request,
        EVAL_SUBJECT,
      );
      return { status: "answered", answer: parseAnswerStream(await response.text()) };
    } catch (error) {
      const reason =
        error instanceof AskUnavailableError
          ? "AskUnavailableError: model failed before any output"
          : describeFailure(error);
      return { status: "failed", reason };
    }
  }

  const entries: EvalEntry[] = [];
  for (const [index, question] of questions.entries()) {
    const outcome = await ask(question);
    entries.push({ question, outcome });
    console.log(
      `[${index + 1}/${questions.length}] ${question.id}: ${outcome.status === "answered" ? "answered" : `failed (${outcome.reason})`}`,
    );
  }

  const finished = new Date();
  const date = toTaipei(finished).date;
  const file = transcriptFileName(finished);
  await writeFile(
    file,
    formatTranscript(
      {
        date,
        modelId,
        voice: env.ASK_VOICE,
        toolsMode: env.ASK_TOOLS,
        promptVersion: ASK_PROMPT_VERSION,
      },
      entries,
    ),
  );
  console.log(`wrote ${file}`);
  return entries.every((e) => e.outcome.status === "failed") ? 1 : 0;
}

const options = parseArgs(process.argv.slice(2));
const questions = selectQuestions(options);
const exitCode = await run(questions).catch((error: unknown) => {
  console.error(describeFailure(error));
  return 1;
});
process.exit(exitCode);
