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
 *
 * Besides the rubric, code checks what a question states in `expect` (src/ask/eval/checks.ts) and
 * keeps four statuses apart: transport, complete, validation and hard. The transcript starts with a
 * summary (tool selection, source support, freshness, abstention, egress attempted/blocked/escaped,
 * fallback, latency, tokens) and records the commit, prompt version, model, API mode and the market
 * dates of the data. Escaped egress is only observable offline (`bun run test`); here it reads "not
 * observable here". Lens suitability is judged by the person only.
 * Exits 1 on bad arguments, an invalid environment, a question that failed to answer, or any failed
 * check.
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { AskUnavailableError, streamAnswer } from "@/ask/ask-service";
import { evaluate, failures, formatSummary, type Scored, summarize } from "@/ask/eval/checks";
import { ASK_QUESTIONS, type AskQuestion } from "@/ask/eval/questions";
import { createRunRecorder } from "@/ask/eval/run-facts";
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
import { getToday } from "@/market/market-service";
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

/** The commit the answers come from, or null (not a git checkout, or git is missing). */
function currentCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** The trade dates of the stored digest and board the answers could draw on. */
async function dataDates(db: ReturnType<typeof getDb>): Promise<string> {
  try {
    const { digest, board } = await getToday(db);
    return `digest ${digest?.tradeDate ?? "none"}; board ${board?.tradeDate ?? "none"} (${board?.session ?? "n/a"})`;
  } catch {
    return "unknown";
  }
}

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
      messages: [...(question.history ?? []), { role: "user", content: question.text }],
      profile: SAMPLE_PROFILE,
    });
    // One recorder per question, so a run's termination and fallback are never another's.
    const recorder = createRunRecorder(logger);
    const started = performance.now();
    try {
      const response = await streamAnswer(
        {
          db,
          model,
          modelId,
          env,
          processEnv: process.env,
          now: new Date(),
          logger: recorder.logger,
        },
        request,
        EVAL_SUBJECT,
      );
      const answer = parseAnswerStream(await response.text());
      const facts = recorder.facts(answer, Math.round(performance.now() - started), null);
      return {
        status: "answered",
        answer,
        score: { facts, results: evaluate(answer, question.expect ?? {}, facts) },
      };
    } catch (error) {
      const reason =
        error instanceof AskUnavailableError
          ? "AskUnavailableError: model failed before any output"
          : describeFailure(error);
      return { status: "failed", reason };
    }
  }

  const entries: EvalEntry[] = [];
  const scored: Scored[] = [];
  let failedRuns = 0;
  for (const [index, question] of questions.entries()) {
    const outcome = await ask(question);
    entries.push({ question, outcome });
    let line: string;
    if (outcome.status === "failed") {
      failedRuns += 1;
      line = `failed (${outcome.reason})`;
    } else if (outcome.score) {
      const bad = failures(outcome.score.results);
      scored.push({
        answer: outcome.answer,
        expect: question.expect ?? {},
        facts: outcome.score.facts,
        results: outcome.score.results,
      });
      if (bad.length > 0) failedRuns += 1;
      line = bad.length === 0 ? "PASS" : `FAIL (${bad.map((r) => r.id).join(", ")})`;
    } else {
      line = "answered";
    }
    console.log(`[${index + 1}/${questions.length}] ${question.id}: ${line}`);
  }
  const summary = formatSummary(summarize(scored));
  for (const line of summary) console.log(line);

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
        commit: currentCommit(),
        api: env.LLM_API,
        dataDates: await dataDates(db),
        summary: [
          ...(questions.length > scored.length
            ? [`${questions.length - scored.length} question(s) produced no answer`]
            : []),
          ...summary,
        ],
      },
      entries,
    ),
  );
  console.log(`wrote ${file}`);
  return failedRuns > 0 ? 1 : 0;
}

const options = parseArgs(process.argv.slice(2));
const questions = selectQuestions(options);
const exitCode = await run(questions).catch((error: unknown) => {
  console.error(describeFailure(error));
  return 1;
});
process.exit(exitCode);
