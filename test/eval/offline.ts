// The offline half of the Ask quality check: scripted models, a fake search service that records
// what reaches it, market fixtures in an in-memory database, and the same checks the live
// `bun run ask:eval` applies. Nothing here touches the network; it runs in CI (`offline.test.ts`).
// All data is synthetic or taken from the repository's saved fixtures.
import { readFileSync } from "node:fs";
import { APICallError } from "ai";
import type { AskVerification } from "@/ask/ask-message";
import type { AskDeps } from "@/ask/ask-service";
import { type Expect, evaluate, type Scored } from "@/ask/eval/checks";
import { createRunRecorder } from "@/ask/eval/run-facts";
import { type EvalAnswer, parseAnswerStream } from "@/ask/eval/transcript";
import { LAST_STEP_NOTE } from "@/ask/prompts/ask";
import type { AskRequest } from "@/ask/schema";
import { openMcpTools } from "@/ask/tools/mcp";
import { collectNumbers } from "@/ask/verify";
import type { Db } from "@/db/client";
import { type NewSnapshot, saveSnapshot } from "@/db/repositories/snapshots";
import { parseDigest, parseSectorBoard } from "@/sources/darkfanxing";
import {
  type CallOptions,
  fakeMcpClient,
  fakeModel,
  SEARCH,
  type StreamResult,
  streamOf,
  textReply,
  toolCallReply,
  toolCallsReply,
  toolResultsIn,
  usage,
} from "../helpers/ask-harness";

export const NOW = new Date("2026-10-08T08:00:00Z");
const fixture = (name: string) => readFileSync(`test/fixtures/darkfanxing/${name}`, "utf8");

export type Market = "none" | "closed" | "mixed";

export type Scenario = {
  id: string;
  /** What the scenario shows, for the report. */
  about: string;
  messages: AskRequest["messages"];
  profile?: AskRequest["profile"];
  market?: Market;
  /** The scripted model: its n-th request is answered by this. */
  model: (call: number, options: CallOptions) => StreamResult;
  /** The fake search service; absent means no external tool is configured. */
  search?: { handler: (args: unknown) => unknown };
  env?: Partial<AskDeps["env"]>;
  /** Strings that must never reach the search service (the egress audit looks for them). */
  protectedValues?: string[];
  expect: Expect;
};

export type Outcome = Scored & { id: string; remoteCalls: unknown[] };

/** A figure the market fixtures carry that no sentence of a scenario writes by itself. */
export const marketFigure = (options: CallOptions): number | undefined =>
  collectNumbers(toolResultsIn(options)).find((n) => Math.abs(n) > 2100 && !Number.isInteger(n));

async function seed(db: Db, market: Market): Promise<void> {
  if (market === "none") return;
  const snapshot = (over: Partial<NewSnapshot>): NewSnapshot => ({
    kind: "sector_board",
    groupName: null,
    tradeDate: "2026-10-08",
    asOf: null,
    session: "closed",
    capturedAt: new Date("2026-10-08T07:00:00Z"),
    rawHtml: "<html></html>",
    parsed: parseSectorBoard(fixture("now-2026-10-08.html")),
    parseError: null,
    parserVersion: 1,
    ...over,
  });
  await saveSnapshot(
    db,
    snapshot({ kind: "digest", parsed: parseDigest(fixture("digest-2026-10-08.html")) }),
  );
  // The board's own session and clock live in its parsed payload.
  const board = parseSectorBoard(fixture("now-2026-10-08.html"));
  await saveSnapshot(
    db,
    market === "mixed"
      ? snapshot({
          session: "intraday",
          asOf: "10:30",
          parsed: { ...board, session: "intraday", asOf: "10:30" },
        })
      : snapshot({ parsed: board }),
  );
}

const refusedContinuation = () =>
  new APICallError({
    message: "Function outputs require one pending previous response",
    url: "http://llm.invalid/v1/responses",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: '{"error":{"code":"invalid_tool_continuation"}}',
    isRetryable: false,
  });

export { refusedContinuation };

const BASE_ENV: AskDeps["env"] = {
  ASK_VOICE: "analyst",
  ASK_TOOLS: "on",
  ASK_MCP_SERVERS: [],
  ASK_MAX_STEPS: 4,
  ASK_TOOL_TIMEOUT_MS: 2000,
  ASK_MAX_OUTPUT_TOKENS: 500,
  ASK_TOTAL_OUTPUT_TOKENS: 1500,
  ASK_CONTEXT_TOKENS: 48_000,
  ASK_MAX_TOOL_CALLS: 8,
  ASK_TOOL_CONCURRENCY: 4,
  ASK_TOOL_RESULT_BUDGET_BYTES: 49_152,
  LLM_TIMEOUT_MS: 10_000,
};

/** Runs one scenario and applies the checks. `db` must be a fresh test database. */
export async function runScenario(scenario: Scenario, db: Db): Promise<Outcome> {
  const { streamAnswer } = await import("@/ask/ask-service");
  await seed(db, scenario.market ?? "closed");

  const recorder = createRunRecorder();

  const search = scenario.search ? fakeMcpClient(scenario.search.handler) : undefined;
  const env = {
    ...BASE_ENV,
    ...scenario.env,
    ASK_MCP_SERVERS: search ? [SEARCH] : [],
  };
  const deps: AskDeps = {
    db,
    model: fakeModel(scenario.model),
    modelId: "scripted",
    env,
    processEnv: {},
    now: NOW,
    logger: recorder.logger,
    ...(search && {
      openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
    }),
  };
  const request: AskRequest = {
    lens: "beginner",
    messages: scenario.messages,
    profile: scenario.profile ?? { holdings: [], memory: [] },
  };

  const started = performance.now();
  const response = await streamAnswer(deps, request, "eval-subject");
  const answer: EvalAnswer = parseAnswerStream(await response.text());
  const latencyMs = Math.round(performance.now() - started);

  const remoteCalls = search ? search.remote.mock.calls.map((call) => call[0]) : [];
  const wire = JSON.stringify(remoteCalls).toLowerCase();
  const escaped = (scenario.protectedValues ?? []).filter((value) =>
    wire.includes(value.toLowerCase()),
  ).length;
  const facts = recorder.facts(answer, latencyMs, escaped);
  return {
    id: scenario.id,
    answer,
    expect: scenario.expect,
    facts,
    results: evaluate(answer, scenario.expect, facts),
    remoteCalls,
  };
}

export type { AskVerification };
export { LAST_STEP_NOTE, streamOf, textReply, toolCallReply, toolCallsReply, usage };
