import { readFileSync } from "node:fs";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, jsonSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskRequest } from "@/ask/schema";
import type { McpServerConfig } from "@/config/env";
import type { Db } from "@/db/client";
import { getAskUsage } from "@/db/repositories/ask-usage";
import { sumLlmUsage } from "@/db/repositories/llm-usage";
import { type NewSnapshot, saveSnapshot } from "@/db/repositories/snapshots";
import { toTaipei } from "@/market-clock/market-clock";
import { parseDigest, parseSectorBoard } from "@/sources/darkfanxing";
import { createTestDb } from "../../test/helpers/test-db";
import type { AskDeps } from "./ask-service";
import { type McpClientLike, type McpConnect, openMcpTools } from "./tools/mcp";
import { collectNumbers } from "./verify";

// The module logger (used by the tools) and the injected one are both spied on.
const moduleLog = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: moduleLog }));

const verifyThrows = vi.hoisted(() => ({ next: false }));
vi.mock("@/ask/verify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ask/verify")>();
  return {
    ...actual,
    findUnsupportedNumbers: (...args: Parameters<typeof actual.findUnsupportedNumbers>) => {
      if (verifyThrows.next) {
        verifyThrows.next = false;
        throw Object.assign(new Error("verifier exploded on SENTINEL_TEXT"), { code: "E_VERIFY" });
      }
      return actual.findUnsupportedNumbers(...args);
    },
  };
});

const { AskUnavailableError, resetToolSupport, streamAnswer } = await import("./ask-service");

const NOW = new Date("2026-10-08T08:00:00Z");
const DAY = toTaipei(NOW).date;
const SUBJECT = "subject-1";

const fixture = (name: string) => readFileSync(`test/fixtures/darkfanxing/${name}`, "utf8");

type CallOptions = MockLanguageModelV4["doStreamCalls"][number];
type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

function streamOf(parts: LanguageModelV4StreamPart[]): StreamResult {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

const textReply = (text: string, tokens = usage(100, 20)): StreamResult =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", usage: tokens, finishReason: { unified: "stop", raw: "stop" } },
  ]);

const toolCallReply = (toolName: string, input: unknown, id = "call-1"): StreamResult =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
    {
      type: "finish",
      usage: usage(50, 10),
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
    },
  ]);

/** A fake model whose n-th call (0-based) is answered by `reply(n, options)`. */
function fakeModel(
  reply: (call: number, options: CallOptions) => StreamResult | Promise<StreamResult>,
) {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => reply(calls++, options),
  });
}

type Chunk = { type: string; [key: string]: unknown };

/** The UI message chunks of an SSE response body. */
async function chunksOf(response: Response): Promise<Chunk[]> {
  const body = await response.text();
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as Chunk);
}

const textOf = (chunks: Chunk[]) =>
  chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => c.delta)
    .join("");
const notices = (chunks: Chunk[]) =>
  chunks.filter((c) => c.type === "data-notice").map((c) => c.data as { kind: string });
const verificationOf = (chunks: Chunk[]) =>
  chunks.find((c) => c.type === "data-verification")?.data as
    | { unsupported: string[]; checked: boolean }
    | undefined;

/** Every value of every tool-result message in a prompt. */
function toolResultsIn(options: CallOptions): unknown[] {
  const out: unknown[] = [];
  for (const message of options.prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result") out.push(part.output);
    }
  }
  return out;
}

const SEARCH: McpServerConfig = {
  name: "search",
  url: "https://mcp.example.com/mcp",
  transport: "http",
  headerEnv: {},
  allow: ["web_search"],
};
const NEWS: McpServerConfig = { ...SEARCH, name: "news", url: "https://news.example.com/mcp" };

function fakeMcpClient(handler: (args: unknown) => unknown) {
  const remote = vi.fn(handler);
  const close = vi.fn(async () => {});
  const client: McpClientLike = {
    tools: async () => ({
      web_search: {
        description: "search the web",
        inputSchema: jsonSchema({
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        }),
        execute: async (args: unknown) => remote(args),
      },
    }),
    close,
  };
  return { client, remote, close };
}

describe("streamAnswer", () => {
  let db: Db;
  let log: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  const request = (over: Partial<AskRequest> = {}): AskRequest => ({
    lens: "beginner",
    messages: [{ role: "user", content: "今天市場怎麼樣？" }],
    profile: { holdings: [], memory: [] },
    ...over,
  });

  const deps = (over: Partial<AskDeps> = {}): AskDeps => ({
    db,
    model: fakeModel(() => textReply("今天市場平穩。")),
    modelId: "fake-model",
    env: {
      ASK_VOICE: "analyst",
      ASK_TOOLS: "on",
      ASK_MCP_SERVERS: [],
      ASK_MAX_STEPS: 4,
      ASK_TOOL_TIMEOUT_MS: 2000,
      ASK_MAX_OUTPUT_TOKENS: 500,
      LLM_TIMEOUT_MS: 10_000,
    },
    processEnv: {},
    now: NOW,
    logger: log as unknown as AskDeps["logger"],
    ...over,
  });

  beforeEach(async () => {
    db = await createTestDb();
    log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    for (const fn of Object.values(moduleLog)) fn.mockReset();
    resetToolSupport();
  });

  afterEach(() => {
    resetToolSupport();
  });

  it("streams a plain answer and ends with the verification part", async () => {
    const model = fakeModel(() => textReply("大盤今天收在 99999 點。"));
    const chunks = await chunksOf(await streamAnswer(deps({ model }), request(), SUBJECT));
    expect(textOf(chunks)).toBe("大盤今天收在 99999 點。");
    const dataParts = chunks.filter((c) => c.type.startsWith("data-"));
    expect(dataParts.at(-1)?.type).toBe("data-verification");
    expect(verificationOf(chunks)).toEqual({ unsupported: ["99999"], checked: true });
    expect(chunks.at(0)?.type).toBe("start");
    expect(chunks.at(-1)?.type).toBe("finish");
  });

  it("uses built-in tools only and says no web was searched when no MCP server is configured", async () => {
    const model = fakeModel(() => textReply("好的。"));
    const chunks = await chunksOf(await streamAnswer(deps({ model }), request(), SUBJECT));
    expect(notices(chunks)).toEqual([{ kind: "no_web", text: "這次沒有查網路" }]);
    const tools = (model.doStreamCalls[0]?.tools ?? []).map((t) => t.name);
    expect(tools).toContain("getMarketToday");
    expect(tools).toContain("loadSkill");
    expect(tools.some((name) => name.includes("__"))).toBe(false);
  });

  it("sends no tools of any kind when ASK_TOOLS is off, without opening MCP", async () => {
    const openMcp = vi.fn(openMcpTools);
    const model = fakeModel(() => textReply("好的。"));
    const base = deps({ model });
    const chunks = await chunksOf(
      await streamAnswer(
        { ...base, openMcp, env: { ...base.env, ASK_TOOLS: "off", ASK_MCP_SERVERS: [SEARCH] } },
        request(),
        SUBJECT,
      ),
    );
    expect(openMcp).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0]?.tools ?? []).toEqual([]);
    expect(notices(chunks)).toEqual([{ kind: "no_tools", text: "這次沒有使用任何工具" }]);
    const system = JSON.stringify(model.doStreamCalls[0]?.prompt[0]);
    expect(system).not.toContain("loadSkill");
    expect(system).not.toContain("getMarketToday");
  });

  it("uses built-in tools only when ASK_TOOLS is on but no MCP tool opened", async () => {
    const connect: McpConnect = async () => ({ tools: async () => ({}), close: async () => {} });
    const model = fakeModel(() => textReply("好的。"));
    const base = deps({ model, openMcp: (input) => openMcpTools({ ...input, connect }) });
    const chunks = await chunksOf(
      await streamAnswer(
        { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } },
        request(),
        SUBJECT,
      ),
    );
    const tools = toolNames(model.doStreamCalls[0]);
    expect(tools).toContain("getMarketToday");
    expect(tools).toContain("loadSkill");
    expect(notices(chunks)).toEqual([{ kind: "no_web", text: "這次沒有查網路" }]);
  });

  it("puts the private context note first as a user message, only when the profile has content", async () => {
    const model = fakeModel(() => textReply("好的。"));
    await chunksOf(
      await streamAnswer(
        deps({ model }),
        request({ profile: { holdings: [{ symbol: "0050", amount: 300_000 }], memory: [] } }),
        SUBJECT,
      ),
    );
    const prompt = model.doStreamCalls[0]?.prompt ?? [];
    expect(prompt[0]?.role).toBe("system");
    expect(prompt[1]?.role).toBe("user");
    expect(JSON.stringify(prompt[1])).toContain("0050");
    expect(JSON.stringify(prompt[2])).toContain("今天市場怎麼樣");

    const bare = fakeModel(() => textReply("好的。"));
    await chunksOf(await streamAnswer(deps({ model: bare }), request(), SUBJECT));
    const barePrompt = bare.doStreamCalls[0]?.prompt ?? [];
    expect(barePrompt).toHaveLength(2);
    expect(JSON.stringify(barePrompt[1])).toContain("今天市場怎麼樣");
  });

  it("grounds the numbers of a getMarketToday result: a tool figure passes, an invented one is flagged", async () => {
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
    await saveSnapshot(db, snapshot({}));

    let grounded: number | undefined;
    const model = fakeModel((call, options) => {
      if (call === 0) return toolCallReply("getMarketToday", {});
      const numbers = collectNumbers(toolResultsIn(options));
      grounded = numbers.find((n) => Math.abs(n) > 2100 && !Number.isInteger(n));
      return textReply(`根據資料，數值是 ${grounded}，另外估計是 98765.4。`);
    });
    const chunks = await chunksOf(await streamAnswer(deps({ model }), request(), SUBJECT));
    expect(grounded).toBeDefined();
    expect(chunks.some((c) => c.type === "tool-output-available")).toBe(true);
    const verification = verificationOf(chunks);
    expect(verification?.checked).toBe(true);
    expect(verification?.unsupported).toEqual(["98765.4"]);
  });

  it("does not flag numbers the user wrote or the profile holds", async () => {
    const model = fakeModel(() => textReply("你說的 12345.6 和你的 0050 持股 345678 元都記下了。"));
    const chunks = await chunksOf(
      await streamAnswer(
        deps({ model }),
        request({
          messages: [{ role: "user", content: "我上次看到 12345.6 這個數字" }],
          profile: { holdings: [{ symbol: "0050", amount: 345_678 }], memory: [] },
        }),
        SUBJECT,
      ),
    );
    expect(verificationOf(chunks)).toEqual({ unsupported: [], checked: true });
  });

  it("sends checked: false when the verifier throws, and logs only its code", async () => {
    verifyThrows.next = true;
    const model = fakeModel(() => textReply("有一個數字 99999。"));
    const chunks = await chunksOf(await streamAnswer(deps({ model }), request(), SUBJECT));
    expect(verificationOf(chunks)).toEqual({ unsupported: [], checked: false });
    expect(log.warn).toHaveBeenCalledWith({ code: "E_VERIFY" }, expect.any(String));
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("SENTINEL_TEXT");
  });

  it("stops a model that keeps calling tools at the step cap", async () => {
    const model = fakeModel((call) =>
      toolCallReply("lookupTerm", { query: "ETF" }, `call-${call}`),
    );
    const base = deps({ model });
    const chunks = await chunksOf(
      await streamAnswer({ ...base, env: { ...base.env, ASK_MAX_STEPS: 3 } }, request(), SUBJECT),
    );
    expect(model.doStreamCalls).toHaveLength(3);
    expect(verificationOf(chunks)).toEqual({ unsupported: [], checked: true });
  });

  const apiError = (statusCode: number, message: string, responseBody?: string) =>
    new APICallError({
      message,
      url: "http://llm.invalid/v1/chat/completions",
      requestBodyValues: {},
      statusCode,
      ...(responseBody !== undefined && { responseBody }),
      isRetryable: false,
    });
  const noToolsError = () =>
    apiError(400, "Bad Request", '{"error":{"message":"This model does not support tools"}}');
  const toolNames = (options: CallOptions | undefined) => (options?.tools ?? []).map((t) => t.name);

  /** Rejects any request that carries a tool for which `rejects(names)` is true. */
  const rejectingModel = (rejects: (names: string[]) => boolean, error = noToolsError) =>
    fakeModel((_call, options) => {
      if (rejects(toolNames(options))) throw error();
      return textReply("沒有工具也能回答。");
    });
  const anyTool = (names: string[]) => names.length > 0;

  it("retries once without tools when the endpoint does not support them, and skips tools afterwards", async () => {
    const first = rejectingModel(anyTool);
    const chunks = await chunksOf(await streamAnswer(deps({ model: first }), request(), SUBJECT));
    expect(first.doStreamCalls).toHaveLength(2);
    expect(toolNames(first.doStreamCalls[1])).toEqual([]);
    expect(notices(chunks)).toEqual([{ kind: "no_tools", text: "這次沒有使用任何工具" }]);
    expect(textOf(chunks)).toBe("沒有工具也能回答。");

    const second = rejectingModel(anyTool);
    const again = await chunksOf(await streamAnswer(deps({ model: second }), request(), SUBJECT));
    expect(second.doStreamCalls).toHaveLength(1);
    expect(toolNames(second.doStreamCalls[0])).toEqual([]);
    expect(notices(again)).toEqual([{ kind: "no_tools", text: "這次沒有使用任何工具" }]);
  });

  it("tries tools again once the remembered rejection is ten minutes old", async () => {
    await chunksOf(
      await streamAnswer(deps({ model: rejectingModel(anyTool) }), request(), SUBJECT),
    );

    const soon = fakeModel(() => textReply("好。"));
    const later = new Date(NOW.getTime() + 9 * 60_000);
    await chunksOf(await streamAnswer(deps({ model: soon, now: later }), request(), SUBJECT));
    expect(toolNames(soon.doStreamCalls[0])).toEqual([]);

    const expired = fakeModel(() => textReply("好。"));
    const tenMinutes = new Date(NOW.getTime() + 10 * 60_000);
    const chunks = await chunksOf(
      await streamAnswer(deps({ model: expired, now: tenMinutes }), request(), SUBJECT),
    );
    expect(toolNames(expired.doStreamCalls[0])).toContain("getMarketToday");
    expect(notices(chunks)).toEqual([{ kind: "no_web", text: "這次沒有查網路" }]);
  });

  it.each([
    ["the response body", () => noToolsError()],
    ["the message", () => apiError(422, "tools are not supported for this model")],
    ["a tool_choice message", () => apiError(400, "tool_choice auto is not supported")],
    [
      "a vLLM hint",
      () => apiError(400, '"auto" tool choice requires --enable-auto-tool-choice to be set'),
    ],
    ["a function-calling message", () => apiError(400, "Function calling is not supported")],
  ])("recognises a tools rejection in %s", async (_label, error) => {
    const model = rejectingModel(anyTool, error);
    const chunks = await chunksOf(await streamAnswer(deps({ model }), request(), SUBJECT));
    expect(notices(chunks)).toEqual([{ kind: "no_tools", text: "這次沒有使用任何工具" }]);
  });

  it("does not fall back for a 400 that merely mentions functions or tools", async () => {
    const model = fakeModel(() => {
      throw apiError(
        400,
        "context length exceeded: the messages plus the functions and tools definitions are too long",
      );
    });
    await expect(streamAnswer(deps({ model }), request(), SUBJECT)).rejects.toBeInstanceOf(
      AskUnavailableError,
    );
    expect(model.doStreamCalls).toHaveLength(1);
    // Nothing remembered: the next request still sends tools.
    const next = fakeModel(() => textReply("好。"));
    await chunksOf(await streamAnswer(deps({ model: next }), request(), SUBJECT));
    expect(toolNames(next.doStreamCalls[0])).toContain("getMarketToday");
  });

  it("retries with built-in tools only when the MCP tools were rejected, without remembering it", async () => {
    const search = fakeMcpClient(() => ({}));
    const model = rejectingModel((names) => names.some((name) => name.includes("__")));
    const base = deps({
      model,
      openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
    });
    const withMcp = { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } };
    const chunks = await chunksOf(await streamAnswer(withMcp, request(), SUBJECT));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(toolNames(model.doStreamCalls[0])).toContain("search__web_search");
    const retried = toolNames(model.doStreamCalls[1]);
    expect(retried).toContain("getMarketToday");
    expect(retried.some((name) => name.includes("__"))).toBe(false);
    expect(notices(chunks)).toEqual([{ kind: "no_web", text: "這次沒有查網路" }]);
    expect(search.close).toHaveBeenCalledTimes(1);

    const next = fakeModel(() => textReply("好。"));
    await chunksOf(await streamAnswer(deps({ model: next }), request(), SUBJECT));
    expect(toolNames(next.doStreamCalls[0])).toContain("getMarketToday");
  });

  it("walks the ladder MCP -> built-ins -> none when every tool set is rejected", async () => {
    const search = fakeMcpClient(() => ({}));
    const model = rejectingModel(anyTool);
    const base = deps({
      model,
      openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
    });
    const chunks = await chunksOf(
      await streamAnswer(
        { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } },
        request(),
        SUBJECT,
      ),
    );
    expect(model.doStreamCalls).toHaveLength(3);
    expect(toolNames(model.doStreamCalls[2])).toEqual([]);
    expect(notices(chunks)).toEqual([{ kind: "no_tools", text: "這次沒有使用任何工具" }]);
  });

  it("answers 503 and remembers nothing when the tool-free retry fails too", async () => {
    const model = fakeModel((_call, options) => {
      if (toolNames(options).length > 0) throw noToolsError();
      throw apiError(500, "upstream down");
    });
    await expect(streamAnswer(deps({ model }), request(), SUBJECT)).rejects.toBeInstanceOf(
      AskUnavailableError,
    );
    expect(model.doStreamCalls).toHaveLength(2);
    const next = fakeModel(() => textReply("好。"));
    await chunksOf(await streamAnswer(deps({ model: next }), request(), SUBJECT));
    expect(toolNames(next.doStreamCalls[0])).toContain("getMarketToday");
  });

  it("names the failed MCP server in a notice and still answers with the others", async () => {
    const search = fakeMcpClient(() => ({ content: [{ type: "text", text: "結果" }] }));
    const connect: McpConnect = async (config) => {
      if (config.name === "news") throw new Error("connect refused");
      return search.client;
    };
    const base = deps({
      model: fakeModel(() => textReply("答案。")),
      openMcp: (input) => openMcpTools({ ...input, connect }),
    });
    const model = base.model as MockLanguageModelV4;
    const chunks = await chunksOf(
      await streamAnswer(
        { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH, NEWS] } },
        request(),
        SUBJECT,
      ),
    );
    expect(notices(chunks)).toEqual([{ kind: "tool_failed", text: "部分外部工具無法使用：news" }]);
    expect(textOf(chunks)).toBe("答案。");
    const tools = (model.doStreamCalls[0]?.tools ?? []).map((t) => t.name);
    expect(tools).toContain("search__web_search");
    expect(tools).toContain("getMarketToday");
    expect(search.close).toHaveBeenCalledTimes(1);
  });

  it("says no web was searched when every MCP server failed", async () => {
    const connect: McpConnect = async () => {
      throw new Error("down");
    };
    const base = deps({ openMcp: (input) => openMcpTools({ ...input, connect }) });
    const chunks = await chunksOf(
      await streamAnswer(
        { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } },
        request(),
        SUBJECT,
      ),
    );
    expect(notices(chunks)).toEqual([
      { kind: "tool_failed", text: "部分外部工具無法使用：search" },
      { kind: "no_web", text: "這次沒有查網路" },
    ]);
  });

  it("blocks an MCP call whose arguments carry a private amount, end to end", async () => {
    const search = fakeMcpClient(() => ({ content: [{ type: "text", text: "結果" }] }));
    let secondPrompt: unknown[] = [];
    const model = fakeModel((call, options) => {
      if (call === 0)
        return toolCallReply("search__web_search", { query: "0050 1,234,567 元 怎麼配置" });
      secondPrompt = toolResultsIn(options);
      return textReply("我不能把金額拿去查。");
    });
    const base = deps({
      model,
      openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
    });
    const chunks = await chunksOf(
      await streamAnswer(
        { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } },
        request({ profile: { holdings: [{ symbol: "0050", amount: 1_234_567 }], memory: [] } }),
        SUBJECT,
      ),
    );
    expect(search.remote).not.toHaveBeenCalled();
    expect(JSON.stringify(secondPrompt)).toContain("blocked_private_data");
    expect(textOf(chunks)).toBe("我不能把金額拿去查。");
  });

  it("blocks an MCP call that carries an amount from a memory note, written another way", async () => {
    const search = fakeMcpClient(() => ({ content: [{ type: "text", text: "結果" }] }));
    let secondPrompt: unknown[] = [];
    const model = fakeModel((call, options) => {
      if (call === 0) return toolCallReply("search__web_search", { query: "200萬 怎麼投資" });
      secondPrompt = toolResultsIn(options);
      return textReply("我不能把金額拿去查。");
    });
    const base = deps({
      model,
      openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
    });
    await chunksOf(
      await streamAnswer(
        { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } },
        request({ profile: { holdings: [], memory: ["我有 2,000,000 存款"] } }),
        SUBJECT,
      ),
    );
    expect(search.remote).not.toHaveBeenCalled();
    expect(JSON.stringify(secondPrompt)).toContain("blocked_private_data");
  });

  it("blocks an MCP call that carries an amount getMyPlan returned earlier in the answer", async () => {
    const search = fakeMcpClient(() => ({ content: [{ type: "text", text: "結果" }] }));
    let planAmount: number | undefined;
    let lastPrompt: unknown[] = [];
    const model = fakeModel((call, options) => {
      if (call === 0) return toolCallReply("getMyPlan", {});
      if (call === 1) {
        const [plan] = toolResultsIn(options) as { value: { reserve: { target: number } } }[];
        planAmount = plan?.value.reserve.target;
        return toolCallReply("search__web_search", { query: `存 ${planAmount} 元 要多久` }, "c2");
      }
      lastPrompt = toolResultsIn(options);
      return textReply("好。");
    });
    const base = deps({
      model,
      openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
    });
    const plan = {
      answers: {
        age: "age-40-49",
        horizon: "horizon-5-10y",
        income: "income-stable",
        reserve: "reserve-3-6m",
        loss: "loss-hold",
      },
      lump: 50_000,
      monthly: 10_000,
      monthlyExpenses: 37_000,
      existingReserve: 0,
    } as const;
    await chunksOf(
      await streamAnswer(
        { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } },
        request({ profile: { plan, holdings: [], memory: [] } }),
        SUBJECT,
      ),
    );
    expect(planAmount).toBeGreaterThanOrEqual(1000);
    expect([50_000, 10_000, 37_000, 0]).not.toContain(planAmount);
    expect(search.remote).not.toHaveBeenCalled();
    expect(JSON.stringify(lastPrompt)).toContain("blocked_private_data");
  });

  it("keeps the request context in derivation even after more than 60 tool results", async () => {
    const calls = Array.from({ length: 61 }, (_, i) => ({
      type: "tool-call" as const,
      toolCallId: `call-${i}`,
      toolName: "lookupTerm",
      input: JSON.stringify({ query: "ETF" }),
    }));
    const model = fakeModel((call) => {
      if (call === 0)
        return streamOf([
          { type: "stream-start", warnings: [] },
          ...calls,
          {
            type: "finish",
            usage: usage(50, 10),
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
          },
        ]);
      return textReply("兩筆加起來是 500000 元。");
    });
    const chunks = await chunksOf(
      await streamAnswer(
        deps({ model }),
        request({
          profile: {
            holdings: [
              { symbol: "0050", amount: 300_000 },
              { symbol: "0056", amount: 200_000 },
            ],
            memory: [],
          },
        }),
        SUBJECT,
      ),
    );
    expect(chunks.filter((c) => c.type === "tool-output-available")).toHaveLength(61);
    expect(verificationOf(chunks)).toEqual({ unsupported: [], checked: true });
  });

  it("throws AskUnavailableError when the model fails before any output, and closes MCP", async () => {
    const search = fakeMcpClient(() => ({}));
    const model = fakeModel(() => {
      throw new APICallError({
        message: "upstream exploded",
        url: "http://llm.invalid",
        requestBodyValues: {},
        statusCode: 500,
        isRetryable: false,
      });
    });
    const base = deps({
      model,
      openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
    });
    await expect(
      streamAnswer(
        { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } },
        request(),
        SUBJECT,
      ),
    ).rejects.toBeInstanceOf(AskUnavailableError);
    expect(search.close).toHaveBeenCalledTimes(1);
  });

  describe("whether a failure before any output is refundable", () => {
    /** The AskUnavailableError a model failing this way produces. */
    async function failure(
      model: MockLanguageModelV4,
      over: Partial<AskDeps> = {},
      timeoutMs = 10_000,
    ): Promise<InstanceType<typeof AskUnavailableError>> {
      const base = deps({ model, ...over });
      const error = await streamAnswer(
        { ...base, env: { ...base.env, LLM_TIMEOUT_MS: timeoutMs } },
        request(),
        SUBJECT,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AskUnavailableError);
      return error as InstanceType<typeof AskUnavailableError>;
    }
    const failing = (error: () => unknown) =>
      fakeModel(() => {
        throw error();
      });
    const hangUntilAbort = (options: CallOptions) =>
      new Promise<StreamResult>((_, reject) => {
        options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason), {
          once: true,
        });
      });

    it.each([500, 502, 503])("refunds a provider HTTP %i", async (status) => {
      expect((await failure(failing(() => apiError(status, "upstream down")))).refundable).toBe(
        true,
      );
    });

    it.each([400, 401, 403, 404, 413, 422, 429])(
      "does not refund a provider HTTP %i",
      async (status) => {
        expect(
          (await failure(failing(() => apiError(status, "context length exceeded")))).refundable,
        ).toBe(false);
      },
    );

    it("refunds a connection failure (no response at all)", async () => {
      const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      const model = failing(
        () =>
          new APICallError({
            message: "Cannot connect to API",
            url: "http://llm.invalid",
            requestBodyValues: {},
            cause: new TypeError("fetch failed", { cause: refused }),
            isRetryable: false,
          }),
      );
      expect((await failure(model)).refundable).toBe(true);
      expect((await failure(failing(() => new TypeError("fetch failed")))).refundable).toBe(true);
    });

    it("refunds our own deadline passing before any output", async () => {
      const model = fakeModel((_call, options) => hangUntilAbort(options));
      expect((await failure(model, {}, 50)).refundable).toBe(true);
    });

    it("does not refund when the client went away", async () => {
      const controller = new AbortController();
      const model = fakeModel((_call, options) => {
        setTimeout(() => controller.abort(), 20);
        return hangUntilAbort(options);
      });
      expect((await failure(model, { abortSignal: controller.signal })).refundable).toBe(false);
    });

    it("does not refund a failure that is neither network nor provider-side", async () => {
      expect((await failure(failing(() => new Error("something odd")))).refundable).toBe(false);
    });

    it("does not refund the leftovers of a tools rejection (a 4xx after the ladder)", async () => {
      const model = fakeModel((_call, options) => {
        if (toolNames(options).length > 0) throw noToolsError();
        throw apiError(400, "context length exceeded");
      });
      expect((await failure(model)).refundable).toBe(false);
    });
  });

  it("aborts the upstream call on client disconnect and closes MCP clients exactly once", async () => {
    const search = fakeMcpClient(() => ({}));
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const model = fakeModel((_call, options) => {
      upstreamSignal = options.abortSignal;
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "t1" });
            c.enqueue({ type: "text-delta", id: "t1", delta: "第一段" });
            options.abortSignal?.addEventListener("abort", () => {
              c.error(new DOMException("aborted", "AbortError"));
            });
          },
        }),
      };
    });
    const base = deps({
      model,
      abortSignal: controller.signal,
      openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
    });
    const response = await streamAnswer(
      { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } },
      request(),
      SUBJECT,
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no body");
    let seen = "";
    while (!seen.includes("第一段")) {
      const { value } = await reader.read();
      seen += new TextDecoder().decode(value);
    }
    controller.abort();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    expect(upstreamSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(search.close).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(search.close).toHaveBeenCalledTimes(1);
  });

  it("writes the usage rows when the answer finishes", async () => {
    const model = fakeModel((call) =>
      call === 0
        ? toolCallReply("lookupTerm", { query: "ETF" })
        : textReply("好。", usage(200, 30)),
    );
    await chunksOf(await streamAnswer(deps({ model }), request(), SUBJECT));
    expect(await getAskUsage(db, SUBJECT, DAY)).toEqual({
      messages: 0,
      inputTokens: 250,
      outputTokens: 40,
      refunds: 0,
    });
    expect(await sumLlmUsage(db, new Date(0))).toEqual({
      calls: 1,
      inputTokens: 250,
      outputTokens: 40,
    });
    const rows = await db.execute(sql`select purpose, model from llm_usage`);
    expect(JSON.stringify(rows)).toContain('"purpose":"ask"');
    expect(JSON.stringify(rows)).toContain('"model":"fake-model"');
    expect(log.info).toHaveBeenCalledWith(
      { steps: 2, toolCalls: 1, inputTokens: 250, outputTokens: 40, ms: expect.any(Number) },
      expect.any(String),
    );
  });

  it("still completes the answer when the usage writes fail", async () => {
    await db.execute(sql`drop table llm_usage`);
    await db.execute(sql`drop table ask_usage`);
    const model = fakeModel(() => textReply("好。"));
    const chunks = await chunksOf(await streamAnswer(deps({ model }), request(), SUBJECT));
    expect(textOf(chunks)).toBe("好。");
    expect(verificationOf(chunks)?.checked).toBe(true);
    expect(chunks.at(-1)?.type).toBe("finish");
    expect(log.warn).toHaveBeenCalledWith({ code: "42P01" }, expect.any(String));
  });

  /** A stream that sends `first`, then waits until the call's abort signal fires, then errors. */
  const hangingReply = (options: CallOptions, first: string): StreamResult => ({
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(c) {
        c.enqueue({ type: "stream-start", warnings: [] });
        c.enqueue({ type: "text-start", id: "t1" });
        c.enqueue({ type: "text-delta", id: "t1", delta: first });
        options.abortSignal?.addEventListener("abort", () => {
          c.error(new DOMException("aborted", "AbortError"));
        });
      },
    }),
  });

  it("ends with a timeout notice, verification and finish when the answer deadline passes mid-answer", async () => {
    const model = fakeModel((_call, options) => hangingReply(options, "先講到 99999 這裡"));
    const base = deps({ model });
    const chunks = await chunksOf(
      await streamAnswer(
        { ...base, env: { ...base.env, LLM_TIMEOUT_MS: 150 } },
        request(),
        SUBJECT,
      ),
    );
    expect(textOf(chunks)).toBe("先講到 99999 這裡");
    expect(notices(chunks)).toContainEqual({ kind: "timeout", text: "回答時間過長，已先停在這裡" });
    const types = chunks.map((c) => c.type);
    expect(types.indexOf("data-verification")).toBeGreaterThan(
      chunks.findIndex(
        (c) => c.type === "data-notice" && (c.data as { kind: string }).kind === "timeout",
      ),
    );
    expect(verificationOf(chunks)).toEqual({ unsupported: ["99999"], checked: true });
    expect(types.at(-1)).toBe("finish");
  });

  it("sends no timeout notice when the client disconnects", async () => {
    const controller = new AbortController();
    const model = fakeModel((_call, options) => {
      setTimeout(() => controller.abort(), 20);
      return hangingReply(options, "第一段");
    });
    const chunks = await chunksOf(
      await streamAnswer(deps({ model, abortSignal: controller.signal }), request(), SUBJECT),
    );
    expect(notices(chunks).some((n) => n.kind === "timeout")).toBe(false);
  });

  describe("a failure after the answer started", () => {
    const PROVIDER_TEXT = "SENTINEL_PROVIDER_TEXT api key sk-123 at http://llm.internal";

    async function runFailing(model: MockLanguageModelV4) {
      const search = fakeMcpClient(() => ({ content: [{ type: "text", text: "結果" }] }));
      const base = deps({
        model,
        openMcp: (input) => openMcpTools({ ...input, connect: async () => search.client }),
      });
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const response = await streamAnswer(
          { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH] } },
          request(),
          SUBJECT,
        );
        const body = await response.clone().text();
        const chunks = await chunksOf(response);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { body, chunks, search, unhandled };
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    }

    async function expectGracefulEnd(run: Awaited<ReturnType<typeof runFailing>>) {
      const { body, chunks, search, unhandled } = run;
      const errors = chunks.filter((c) => c.type === "error");
      expect(errors).toEqual([{ type: "error", errorText: "發生錯誤，請稍後再試。" }]);
      expect(body).not.toContain("SENTINEL_PROVIDER_TEXT");
      const types = chunks.map((c) => c.type);
      expect(types.indexOf("data-verification")).toBeGreaterThan(types.indexOf("error"));
      expect(types.at(-1)).toBe("finish");
      expect(verificationOf(chunks)?.checked).toBe(true);
      expect(search.close).toHaveBeenCalledTimes(1);
      expect((await sumLlmUsage(db, new Date(0))).calls).toBe(1);
      expect(unhandled).not.toHaveBeenCalled();
      const logged = JSON.stringify([
        ...Object.values(log).flatMap((fn) => fn.mock.calls),
        ...Object.values(moduleLog).flatMap((fn) => fn.mock.calls),
      ]);
      expect(logged).not.toContain("SENTINEL_PROVIDER_TEXT");
    }

    it("turns an error part after some text into the fixed error text", async () => {
      const model = fakeModel(() =>
        streamOf([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "前半段 99999" },
          { type: "error", error: new Error(PROVIDER_TEXT) },
        ]),
      );
      const run = await runFailing(model);
      expect(textOf(run.chunks)).toBe("前半段 99999");
      expect(verificationOf(run.chunks)?.unsupported).toEqual(["99999"]);
      await expectGracefulEnd(run);
    });

    it("turns a failing second call (after a tool result) into the fixed error text", async () => {
      const model = fakeModel((call) => {
        if (call === 0) return toolCallReply("lookupTerm", { query: "ETF" });
        throw apiError(500, PROVIDER_TEXT, PROVIDER_TEXT);
      });
      const run = await runFailing(model);
      expect(run.chunks.some((c) => c.type === "tool-output-available")).toBe(true);
      await expectGracefulEnd(run);
    });
  });

  it("grounds numbers from earlier turns, the user's and the assistant's", async () => {
    const model = fakeModel(() =>
      textReply("你提到 4321.5，我上次說的 8765.4 還是一樣，另外 5555.5 是新的。"),
    );
    const chunks = await chunksOf(
      await streamAnswer(
        deps({ model }),
        request({
          messages: [
            { role: "user", content: "我看到 4321.5" },
            { role: "assistant", content: "大概是 8765.4 吧。" },
            { role: "user", content: "真的嗎？" },
          ],
        }),
        SUBJECT,
      ),
    );
    expect(verificationOf(chunks)?.unsupported).toEqual(["5555.5"]);
  });

  it("logs a connection error's code from deep in the cause chain, never a malformed one", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), {
      code: "ECONNREFUSED",
    });
    const model = fakeModel(() => {
      throw new APICallError({
        message: "Cannot connect to API",
        url: "http://llm.invalid",
        requestBodyValues: {},
        cause: new TypeError("fetch failed", { cause: refused }),
        isRetryable: false,
      });
    });
    await expect(streamAnswer(deps({ model }), request(), SUBJECT)).rejects.toBeInstanceOf(
      AskUnavailableError,
    );
    expect(log.warn).toHaveBeenCalledWith(
      { code: "ECONNREFUSED", endpoint: "http://llm.invalid/" },
      "ask model unavailable",
    );

    log.warn.mockClear();
    const malformed = fakeModel(() => {
      throw new APICallError({
        message: "x",
        url: "http://llm.invalid",
        requestBodyValues: {},
        cause: new Error("y", { cause: { code: "SENTINEL secret text" } }),
        isRetryable: false,
      });
    });
    await expect(
      streamAnswer(deps({ model: malformed }), request(), SUBJECT),
    ).rejects.toBeInstanceOf(AskUnavailableError);
    expect(log.warn).toHaveBeenCalledWith(
      { endpoint: "http://llm.invalid/" },
      "ask model unavailable",
    );
  });

  it("explains a 403 challenge page in the log without logging the page", async () => {
    const model = fakeModel(() => {
      throw new APICallError({
        message: "SENTINEL_PROVIDER_TEXT",
        url: "https://llm.example.com/chat/completions",
        requestBodyValues: {},
        statusCode: 403,
        responseHeaders: { "content-type": "text/html; charset=UTF-8", server: "cloudflare" },
        responseBody:
          "<!DOCTYPE html><html><head><title>Just a moment...</title></head>SENTINEL_PROVIDER_TEXT</html>",
        isRetryable: false,
      });
    });
    await expect(streamAnswer(deps({ model }), request(), SUBJECT)).rejects.toBeInstanceOf(
      AskUnavailableError,
    );
    expect(log.warn).toHaveBeenCalledWith(
      {
        statusCode: 403,
        endpoint: "https://llm.example.com/chat/completions",
        contentType: "text/html",
        hint: expect.stringContaining("/v1"),
      },
      "ask model unavailable",
    );
    expect(log.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        htmlTitle: "Just a moment...",
        server: "cloudflare",
        errorName: "AI_APICallError",
      }),
      "ask model failure detail",
    );
    const logged = JSON.stringify(Object.values(log).flatMap((fn) => fn.mock.calls));
    expect(logged).not.toContain("SENTINEL_PROVIDER_TEXT");
  });

  it("never logs message text, amounts or tool arguments", async () => {
    const search = fakeMcpClient(() => ({ content: [{ type: "text", text: "SENTINEL_RESULT" }] }));
    const model = fakeModel((call) => {
      if (call === 0) return toolCallReply("search__web_search", { query: "SENTINEL_ARG" });
      if (call === 1) return toolCallReply("lookupTerm", { query: "SENTINEL_TERM" }, "call-2");
      return textReply("SENTINEL_ANSWER 7654321");
    });
    const base = deps({
      model,
      openMcp: (input) =>
        openMcpTools({
          ...input,
          connect: async (config) => {
            if (config.name === "news") throw new Error("SENTINEL_ERROR");
            return search.client;
          },
        }),
    });
    await chunksOf(
      await streamAnswer(
        { ...base, env: { ...base.env, ASK_MCP_SERVERS: [SEARCH, NEWS] } },
        request({
          messages: [{ role: "user", content: "SENTINEL_QUESTION 我有 7654321 元" }],
          profile: {
            holdings: [{ symbol: "0050", amount: 7_654_321 }],
            memory: ["SENTINEL_MEMORY"],
          },
        }),
        SUBJECT,
      ),
    );
    const logged = JSON.stringify([
      ...Object.values(log).flatMap((fn) => fn.mock.calls),
      ...Object.values(moduleLog).flatMap((fn) => fn.mock.calls),
    ]);
    expect(log.info).toHaveBeenCalled();
    for (const sentinel of [
      "SENTINEL_QUESTION",
      "SENTINEL_ARG",
      "SENTINEL_TERM",
      "SENTINEL_RESULT",
      "SENTINEL_ANSWER",
      "SENTINEL_MEMORY",
      "SENTINEL_ERROR",
      "7654321",
      "7,654,321",
    ]) {
      expect(logged).not.toContain(sentinel);
    }
  });
});
