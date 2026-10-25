// What the app sends to the LLM provider, audited at the HTTP boundary for both API modes. The real
// AI SDK request builders run against a scripted `fetch`, so these are the bytes that would leave.
//
// The model provider is not an external tool: it is told the user's private context by design (the
// profile note), so what this audit pins down is the rest: no credential or identity of ours, no
// evidence or verification state, the private note sent once, and the tool cycle shaped the way
// each API needs it. `store` is deliberately not forced to false: the Responses continuation sends
// only the pending tool outputs plus `previous_response_id`, which only works if the provider keeps
// the earlier response.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { createModelFromEnv } from "@/insight/llm";
import { chunksOf, textOf } from "../../test/helpers/ask-harness";
import { fakeProvider, type ProviderRequest } from "../../test/helpers/fake-provider";
import { createTestDb } from "../../test/helpers/test-db";
import type { AskDeps } from "./ask-service";
import type { AskRequest } from "./schema";

const moduleLog = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: moduleLog }));

const { streamAnswer } = await import("./ask-service");

const NOW = new Date("2026-10-08T08:00:00Z");
const LLM_KEY = "sk-test-LLM-KEY-123456";
const SUBJECT = "hashed-subject-xyz";
const MCP_SECRET = "Bearer SECRET-MCP-TOKEN";
const NOTE = "我兩年內想買房";

const REQUEST: AskRequest = {
  lens: "beginner",
  messages: [{ role: "user", content: "ETF 和殖利率是什麼？" }],
  profile: { holdings: [{ symbol: "0050", amount: 300_000 }], memory: [NOTE] },
};

const TWO_CALLS = {
  calls: [
    { name: "lookupTerm", args: { query: "ETF" } },
    { name: "lookupTerm", args: { query: "殖利率" } },
  ],
  lead: "我先查名詞。",
};

describe.each(["responses", "chat"] as const)("the provider payload (LLM_API=%s)", (api) => {
  let db: Db;
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    db = await createTestDb();
    for (const fn of [...Object.values(moduleLog), ...Object.values(log)]) fn.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const run = async (script: Parameters<typeof fakeProvider>[1], request = REQUEST) => {
    const provider = fakeProvider(api, script);
    vi.stubGlobal("fetch", provider.fetch);
    const model = createModelFromEnv({
      LLM_BASE_URL: "https://llm.example.com/v1",
      LLM_API_KEY: LLM_KEY,
      LLM_MODEL: "model-x",
      LLM_API: api,
    });
    const deps: AskDeps = {
      db,
      model,
      modelId: "model-x",
      env: {
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
      },
      processEnv: { SEARCH_MCP_AUTH: MCP_SECRET },
      now: NOW,
      logger: log as unknown as AskDeps["logger"],
    };
    const chunks = await chunksOf(await streamAnswer(deps, request, SUBJECT));
    return { chunks, requests: provider.requests };
  };

  const systemText = (request: ProviderRequest): string => {
    const items: { role?: string; content?: unknown }[] =
      request.body.input ?? request.body.messages;
    return items
      .filter((item) => item.role === "system" || item.role === "developer")
      .map((item) =>
        typeof item.content === "string" ? item.content : JSON.stringify(item.content),
      )
      .join("\n");
  };

  it("calls the endpoint of the configured API, with the key in the header only", async () => {
    const { requests } = await run([{ text: "好。" }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe(api === "responses" ? "/v1/responses" : "/v1/chat/completions");
    expect(requests[0]?.headers.authorization).toBe(`Bearer ${LLM_KEY}`);
    expect(JSON.stringify(requests[0]?.body)).not.toContain(LLM_KEY);
  });

  it("sends the private note once, and nothing of ours beyond the conversation", async () => {
    const { requests } = await run([TWO_CALLS, { text: "ETF 是一種基金。" }]);
    for (const request of requests) {
      const wire = JSON.stringify(request.body);
      expect(wire).not.toContain(SUBJECT);
      expect(wire).not.toContain(MCP_SECRET);
      expect(wire).not.toContain(LLM_KEY);
      // Our own bookkeeping never goes to the model.
      expect(wire).not.toMatch(/data-verification|"evidence"|sourceId|retrievedAt/);
    }
    const first = JSON.stringify(requests[0]?.body);
    expect(first.split(NOTE)).toHaveLength(2);
    expect(first).toContain("0050");
  });

  it("offers the read-only tools, and none that can write", async () => {
    const { requests } = await run([{ text: "好。" }]);
    const tools: { name?: string; function?: { name: string } }[] = requests[0]?.body.tools ?? [];
    const names = tools.map((tool) => tool.name ?? tool.function?.name).sort();
    expect(names).toEqual(
      [
        "getInstrumentHistory",
        "getLatestBriefing",
        "getMarketToday",
        "getMyPlan",
        "getSectorBoard",
        "loadSkill",
        "lookupTerm",
      ].sort(),
    );
  });

  it("never turns off provider-side storage: the continuation depends on it", async () => {
    const { requests } = await run([TWO_CALLS, { text: "好。" }]);
    for (const request of requests) expect(request.body.store).not.toBe(false);
  });

  it("returns several tool results of one step to the model, matched to their calls", async () => {
    const { chunks, requests } = await run([TWO_CALLS, { text: "ETF 是一種基金。" }]);
    expect(textOf(chunks)).toContain("ETF 是一種基金。");
    expect(requests).toHaveLength(2);
    const second = requests[1] as ProviderRequest;

    if (api === "responses") {
      // The continuation names the first response and carries only what the server lacks.
      expect(second.body.previous_response_id).toBe("resp_1");
      const input: { type?: string; call_id?: string; role?: string }[] = second.body.input;
      expect(input.map((item) => item.type)).toEqual([
        "function_call_output",
        "function_call_output",
      ]);
      expect(input.map((item) => item.call_id)).toEqual(["call_1_1", "call_1_2"]);
      // Instructions are not inherited from the first response: they are sent again, at the top.
      expect(second.body.instructions).toContain(
        systemText(requests[0] as ProviderRequest).slice(0, 80),
      );
      expect(input.some((item) => item.role === "system" || item.role === "developer")).toBe(false);
    } else {
      expect(second.body.previous_response_id).toBeUndefined();
      const messages: {
        role: string;
        tool_calls?: { id: string }[];
        tool_call_id?: string;
      }[] = second.body.messages;
      const assistant = messages.find((message) => message.tool_calls);
      expect(assistant?.tool_calls?.map((call) => call.id)).toEqual(["call_1_1", "call_1_2"]);
      expect(
        messages
          .filter((message) => message.role === "tool")
          .map((message) => message.tool_call_id),
      ).toEqual(["call_1_1", "call_1_2"]);
      expect(systemText(second)).toBe(systemText(requests[0] as ProviderRequest));
    }
  });

  it("answers from the results as text, without tools, when the endpoint refuses the continuation", async () => {
    const { chunks, requests } = await run((index, request) => {
      if (index === 0) return TWO_CALLS;
      if (request.body.tools?.length > 0) {
        return {
          status: 400,
          body: '{"error":{"code":"invalid_tool_continuation","message":"Function outputs require one pending previous response"}}',
        };
      }
      return { text: "根據查到的名詞，ETF 是一種基金。" };
    });
    expect(textOf(chunks)).toContain("根據查到的名詞");
    expect(requests).toHaveLength(3);
    const fallback = requests[2] as ProviderRequest;
    expect(fallback.body.tools ?? []).toEqual([]);
    expect(fallback.body.previous_response_id).toBeUndefined();
    expect(JSON.stringify(fallback.body)).toContain("【工具結果】");
  });
});
