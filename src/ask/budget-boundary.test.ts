// What bounds one Ask answer, asserted at the service: a scripted model asks for more tools, more
// steps and more output than one answer may use, and a fake MCP server hangs or goes away.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import {
  chunksOf,
  fakeMcpClient,
  fakeModel,
  notices,
  SEARCH,
  streamOf,
  textOf,
  textReply,
  toolCallReply,
  toolCallsReply,
  toolResultsIn,
  usage,
  verificationOf,
} from "../../test/helpers/ask-harness";
import { createTestDb } from "../../test/helpers/test-db";
import type { AskDeps } from "./ask-service";
import { LAST_STEP_NOTE } from "./prompts/ask";
import type { AskRequest } from "./schema";
import { openMcpTools } from "./tools/mcp";

const moduleLog = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: moduleLog }));

const { AskUnavailableError, streamAnswer } = await import("./ask-service");

const NOW = new Date("2026-10-08T08:00:00Z");
const REQUEST: AskRequest = {
  lens: "beginner",
  messages: [{ role: "user", content: "ETF 是什麼？" }],
  profile: { holdings: [], memory: [] },
};

describe("what bounds one answer", () => {
  let db: Db;
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    db = await createTestDb();
    for (const fn of [...Object.values(moduleLog), ...Object.values(log)]) fn.mockReset();
  });

  const deps = (over: Partial<AskDeps> = {}, env: Partial<AskDeps["env"]> = {}): AskDeps => ({
    db,
    model: fakeModel(() => textReply("好。")),
    modelId: "fake-model",
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
      ...env,
    },
    processEnv: {},
    now: NOW,
    logger: log as unknown as AskDeps["logger"],
    ...over,
  });

  /** The fields of the last "ask answered" log line. */
  const answered = () => {
    const call = log.info.mock.calls.find(([, message]) => message === "ask answered");
    return call?.[0] as Record<string, unknown>;
  };

  const systemOf = (options: { prompt: { role: string; content: unknown }[] }) =>
    JSON.stringify(options.prompt.filter((m) => m.role === "system"));

  it("refuses the calls past the total limit when one step asks for dozens, and says so", async () => {
    const calls = Array.from({ length: 30 }, (_, i) => ({
      toolName: "lookupTerm",
      input: { query: `詞${i}` },
      id: `call-${i}`,
    }));
    const model = fakeModel((call) =>
      call === 0 ? toolCallsReply(calls) : textReply("先到這裡。"),
    );
    // A budget far above what 30 small results need: the call limit is what stops the burst.
    const chunks = await chunksOf(
      await streamAnswer(
        deps({ model }, { ASK_TOOL_RESULT_BUDGET_BYTES: 50_000_000 }),
        REQUEST,
        "s",
      ),
    );

    const results = toolResultsIn(model.doStreamCalls[1] as never) as { value?: unknown }[];
    const refused = JSON.stringify(results).match(/tool_limit_reached/g) ?? [];
    expect(results).toHaveLength(30);
    expect(refused).toHaveLength(22);
    expect(notices(chunks).map((n) => n.kind)).toContain("limited");
    expect(answered()).toMatchObject({
      termination: "tool_limit",
      toolsRun: 8,
      toolsRefused: { tool_limit_reached: 22 },
    });
    expect(verificationOf(chunks)).toMatchObject({ checked: true });
  });

  it("answers a repeated identical read from the first result and calls the loop at the fourth", async () => {
    const same = Array.from({ length: 5 }, (_, i) => ({
      toolName: "lookupTerm",
      input: { query: "ETF" },
      id: `call-${i}`,
    }));
    const model = fakeModel((call) => (call === 0 ? toolCallsReply(same) : textReply("好。")));
    const chunks = await chunksOf(await streamAnswer(deps({ model }), REQUEST, "s"));
    expect(answered()).toMatchObject({
      termination: "loop",
      toolsRun: 1,
      toolsReused: 2,
      toolsRefused: { repeated_call: 2 },
    });
    expect(notices(chunks).map((n) => n.kind)).toContain("limited");
  });

  it("does not wait for a tool that never answers", async () => {
    const search = fakeMcpClient(() => new Promise(() => {}));
    const model = fakeModel((call) =>
      call === 0
        ? toolCallReply("search__web_search", { query: "0050 殖利率" })
        : textReply("沒查到。"),
    );
    const started = performance.now();
    const chunks = await chunksOf(
      await streamAnswer(
        deps(
          {
            model,
            openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
          },
          { ASK_MCP_SERVERS: [SEARCH], ASK_TOOL_TIMEOUT_MS: 50 },
        ),
        REQUEST,
        "s",
      ),
    );
    expect(performance.now() - started).toBeLessThan(1500);
    expect(textOf(chunks)).toBe("沒查到。");
    expect(JSON.stringify(toolResultsIn(model.doStreamCalls[1] as never))).toContain("tool_failed");
    expect(verificationOf(chunks)?.evidence?.failed).toContain("search__web_search");
  });

  it("stops opening an external server when the client goes away", async () => {
    const goneAfter = new AbortController();
    setTimeout(() => goneAfter.abort(), 20);
    const started = performance.now();
    await expect(
      streamAnswer(
        deps(
          {
            model: fakeModel(() => textReply("好。")),
            abortSignal: goneAfter.signal,
            openMcp: (input) => openMcpTools({ ...input, connect: () => new Promise(() => {}) }),
          },
          { ASK_MCP_SERVERS: [SEARCH], ASK_TOOL_TIMEOUT_MS: 5000 },
        ),
        REQUEST,
        "s",
      ),
    ).rejects.toMatchObject({ name: "AskUnavailableError", refundable: false });
    expect(performance.now() - started).toBeLessThan(1500);
  });

  describe("the last step", () => {
    it("tells the model to answer from what it has, and reports the step limit", async () => {
      const model = fakeModel((call) =>
        toolCallReply("lookupTerm", { query: `詞${call}` }, `call-${call}`),
      );
      await chunksOf(await streamAnswer(deps({ model }, { ASK_MAX_STEPS: 3 }), REQUEST, "s"));
      const prompts = model.doStreamCalls.map((call) => systemOf(call as never));
      expect(prompts).toHaveLength(3);
      expect(prompts[0]).not.toContain(LAST_STEP_NOTE);
      expect(prompts[1]).not.toContain(LAST_STEP_NOTE);
      expect(prompts[2]).toContain(LAST_STEP_NOTE);
      expect(answered()).toMatchObject({ termination: "step_limit", steps: 3 });
    });

    it("keeps the note off a single-step run", async () => {
      const model = fakeModel(() => textReply("好。"));
      await chunksOf(await streamAnswer(deps({ model }, { ASK_MAX_STEPS: 1 }), REQUEST, "s"));
      expect(systemOf(model.doStreamCalls[0] as never)).not.toContain(LAST_STEP_NOTE);
    });
  });

  describe("the output budget", () => {
    const spendy = (call: number) =>
      streamOf([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: `call-${call}`,
          toolName: "lookupTerm",
          input: JSON.stringify({ query: `詞${call}` }),
        },
        {
          type: "finish",
          usage: usage(50, 600),
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
        },
      ]);

    it("ends the run once the steps have spent it, with the last step told to answer", async () => {
      const model = fakeModel((call) => spendy(call));
      await chunksOf(await streamAnswer(deps({ model }, { ASK_MAX_STEPS: 10 }), REQUEST, "s"));
      // 600 + 600 spent, 500 reserved for the answer: the third step is the last.
      expect(model.doStreamCalls).toHaveLength(3);
      expect(systemOf(model.doStreamCalls[2] as never)).toContain(LAST_STEP_NOTE);
      expect(answered()).toMatchObject({ termination: "output_budget" });
    });
  });

  it("gives the fallback answer only what the earlier steps left of the output budget", async () => {
    const { APICallError } = await import("ai");
    const model = fakeModel((call, options) => {
      if (call === 0) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "call-0",
            toolName: "lookupTerm",
            input: JSON.stringify({ query: "ETF" }),
          },
          {
            type: "finish",
            usage: usage(50, 1200),
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
          },
        ]);
      }
      if (options.tools && options.tools.length > 0) {
        throw new APICallError({
          message: "Function outputs require one pending previous response",
          url: "http://llm.invalid/v1/responses",
          requestBodyValues: {},
          statusCode: 400,
          responseBody: '{"error":{"code":"invalid_tool_continuation"}}',
          isRetryable: false,
        });
      }
      return textReply("改用文字結果回答。");
    });
    const chunks = await chunksOf(await streamAnswer(deps({ model }), REQUEST, "s"));
    expect(textOf(chunks)).toBe("改用文字結果回答。");
    const fallback = model.doStreamCalls.at(-1);
    // 1500 total - 1200 spent = 300, above the floor of 256.
    expect(fallback?.maxOutputTokens).toBe(300);
  });

  describe("the context budget", () => {
    /** The text of every user and assistant message a model call was sent, in order. */
    const conversationOf = (call: { prompt: { role: string; content: unknown }[] }) =>
      call.prompt
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role,
          text: Array.isArray(m.content)
            ? m.content.map((part: { text?: string }) => part.text ?? "").join("")
            : String(m.content),
        }));

    const turn = (n: number) =>
      `第${n}則：${"請幫我看台積電與大盤的長期走勢，不要只看單日漲跌。".repeat(160)}`.slice(
        0,
        4000,
      );

    it("sends a long Traditional-Chinese history oldest-trimmed, tells the reader, and logs the drop", async () => {
      const messages = Array.from({ length: 19 }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: turn(i),
      }));
      const request: AskRequest = {
        ...REQUEST,
        messages: [...messages, { role: "user", content: "所以現在到底該怎麼看？" }],
      };
      const model = fakeModel(() => textReply("先看長期。"));
      const chunks = await chunksOf(await streamAnswer(deps({ model }), request, "s"));

      const sent = conversationOf(model.doStreamCalls[0] as never);
      expect(sent.length).toBeLessThan(request.messages.length);
      expect(sent.at(-1)).toEqual({ role: "user", text: "所以現在到底該怎麼看？" });
      expect(sent[0]?.role).toBe("user");
      // What was kept is the newest run of the conversation, in order.
      const keptTexts = sent.slice(0, -1).map((m) => m.text);
      expect(keptTexts).toEqual(
        messages.slice(messages.length - keptTexts.length).map((m) => m.content),
      );
      expect(notices(chunks).map((n) => n.kind)).toContain("trimmed");
      const trimmed = log.info.mock.calls.find(([, message]) => message === "ask context trimmed");
      expect(trimmed?.[0]).toMatchObject({
        droppedMessages: request.messages.length - sent.length,
      });
      expect(trimmed?.[0].estimatedTokens).toBeLessThanOrEqual(48_000);
      expect(answered()).toMatchObject({ droppedMessages: request.messages.length - sent.length });
      expect(JSON.stringify(log.info.mock.calls)).not.toContain("台積電");
    });

    it("sends a short conversation whole, with no notice", async () => {
      const model = fakeModel(() => textReply("好。"));
      const chunks = await chunksOf(await streamAnswer(deps({ model }), REQUEST, "s"));
      expect(conversationOf(model.doStreamCalls[0] as never)).toEqual([
        { role: "user", text: "ETF 是什麼？" },
      ]);
      expect(notices(chunks).map((n) => n.kind)).not.toContain("trimmed");
    });

    it("caps the tool results folded into the follow-up prompt, whatever they add up to", async () => {
      const { APICallError } = await import("ai");
      const search = fakeMcpClient(() => ({
        content: [{ type: "text", text: "市場消息".repeat(8000) }],
      }));
      const calls = Array.from({ length: 6 }, (_, i) => ({
        toolName: "search__web_search",
        input: { query: `0050 消息 ${i}` },
        id: `call-${i}`,
      }));
      const model = fakeModel((call, options) => {
        if (call === 0) return toolCallsReply(calls);
        if (options.tools && options.tools.length > 0) {
          throw new APICallError({
            message: "Function outputs require one pending previous response",
            url: "http://llm.invalid/v1/responses",
            requestBodyValues: {},
            statusCode: 400,
            responseBody: '{"error":{"code":"invalid_tool_continuation"}}',
            isRetryable: false,
          });
        }
        return textReply("只用已查到的資料回答。");
      });
      const chunks = await chunksOf(
        await streamAnswer(
          deps(
            {
              model,
              openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
            },
            { ASK_MCP_SERVERS: [SEARCH], ASK_MAX_TOOL_CALLS: 8 },
          ),
          REQUEST,
          "s",
        ),
      );
      expect(textOf(chunks)).toBe("只用已查到的資料回答。");
      const fallback = conversationOf(model.doStreamCalls.at(-1) as never);
      const folded = fallback.at(-1)?.text ?? "";
      expect(folded).toContain("【工具結果】");
      // 49152 bytes / 3 per token / 1.5 tokens per CJK character, plus the framing of six lines.
      expect(folded.length).toBeLessThan(10_922 + 6 * 600);
    });
  });

  it("exports the unavailable error the route maps", () => {
    expect(new AskUnavailableError("x", false).refundable).toBe(false);
  });
});
