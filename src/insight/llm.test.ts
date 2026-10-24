import { APICallError, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLlm, createLlmFromEnv, createModelFromEnv, LlmOutputError } from "./llm";

type CallOptions = MockLanguageModelV4["doGenerateCalls"][number];
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const API_KEY = "sk-secret-llm-key-1234567890";
const SYSTEM = "你是台股解說員。";
const PROMPT = "事實表：加權指數收 23456.78 點。";

const schema = z.object({ title: z.string(), points: z.array(z.string()).min(1) });
const good = { title: "盤勢", points: ["加權指數收 23456.78 點"] };

function reply(text: string, inputTokens = 10, outputTokens = 5): GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: {
        total: inputTokens,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: outputTokens, text: undefined, reasoning: undefined },
    },
    warnings: [],
  };
}

function rejectResponseFormat(statusCode: number): APICallError {
  return new APICallError({
    message: "response_format is not supported",
    url: "https://llm.example.com/v1/chat/completions",
    requestBodyValues: { messages: [{ role: "user", content: PROMPT }] },
    statusCode,
    responseBody: '{"error":"unsupported parameter: response_format"}',
    isRetryable: false,
  });
}

/** A mock model that answers each call from `steps` in order (a value is returned, an Error thrown). */
function scriptedModel(steps: Array<string | Error>) {
  let index = 0;
  return new MockLanguageModelV4({
    modelId: "mock-model",
    doGenerate: async (options) => {
      options.abortSignal?.throwIfAborted();
      const step = steps[index++];
      if (step === undefined) throw new Error("unexpected extra model call");
      if (step instanceof Error) throw step;
      return reply(step);
    },
  });
}

function messageText(call: CallOptions, role: "system" | "user"): string {
  return call.prompt
    .filter((message) => message.role === role)
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => ("text" in part ? part.text : "")).join(""),
    )
    .join("\n");
}

function callAt(model: MockLanguageModelV4, index: number): CallOptions {
  const call = model.doGenerateCalls[index];
  if (!call) throw new Error(`model call ${index} was not made`);
  return call;
}

const base = { modelId: "mock-model", timeoutMs: 5000, maxOutputTokens: 4000 } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLlm native mode", () => {
  it("returns the structured object and usage", async () => {
    const model = scriptedModel([JSON.stringify(good)]);
    const llm = createLlm({ ...base, model, mode: "native" });

    const result = await llm.generateObject({ system: SYSTEM, prompt: PROMPT, schema });

    expect(result).toEqual({ object: good, usage: { inputTokens: 10, outputTokens: 5 } });
    expect(llm.modelId).toBe("mock-model");
    const call = callAt(model, 0);
    expect(call.responseFormat).toMatchObject({ type: "json" });
    expect(call.maxOutputTokens).toBe(4000);
  });

  it.each([400, 422])(
    "falls back to prompt mode for good after a %i rejecting response_format, and logs the switch",
    async (statusCode) => {
      const model = scriptedModel([
        rejectResponseFormat(statusCode),
        JSON.stringify(good),
        JSON.stringify(good),
      ]);
      const warn = vi.fn();
      const llm = createLlm({ ...base, model, mode: "native", logger: { warn } });

      await expect(llm.generateObject({ system: SYSTEM, prompt: PROMPT, schema })).resolves.toEqual(
        expect.objectContaining({ object: good }),
      );
      expect(model.doGenerateCalls).toHaveLength(2);
      expect(callAt(model, 1).responseFormat?.type).not.toBe("json");
      expect(messageText(callAt(model, 1), "system")).toContain(
        "只輸出一個 JSON 物件，不要其他文字",
      );
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toEqual({ statusCode });
      expect(JSON.stringify(warn.mock.calls[0])).not.toContain("llm.example.com");

      await llm.generateObject({ system: SYSTEM, prompt: PROMPT, schema });
      expect(model.doGenerateCalls).toHaveLength(3);
      expect(callAt(model, 2).responseFormat?.type).not.toBe("json");
      expect(warn).toHaveBeenCalledOnce();
    },
  );

  it("retries a schema-invalid native reply through the prompt path for that request only", async () => {
    const model = scriptedModel([
      JSON.stringify({ title: 42, points: [] }),
      JSON.stringify(good),
      JSON.stringify(good),
    ]);
    const warn = vi.fn();
    const llm = createLlm({ ...base, model, mode: "native", logger: { warn } });

    const result = await llm.generateObject({ system: SYSTEM, prompt: PROMPT, schema });

    expect(result).toEqual({ object: good, usage: { inputTokens: 20, outputTokens: 10 } });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(callAt(model, 1).responseFormat?.type).not.toBe("json");
    // No sticky switch: the next request asks for native output again.
    await llm.generateObject({ system: SYSTEM, prompt: PROMPT, schema });
    expect(callAt(model, 2).responseFormat).toMatchObject({ type: "json" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("retries an unparsable native reply through the prompt path", async () => {
    const model = scriptedModel(["這不是 JSON", JSON.stringify(good)]);
    const llm = createLlm({ ...base, model, mode: "native" });

    await expect(llm.generateObject({ system: SYSTEM, prompt: PROMPT, schema })).resolves.toEqual(
      expect.objectContaining({ object: good }),
    );
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("throws LlmOutputError with the summed usage when the prompt-path retry also fails", async () => {
    const bad = JSON.stringify({ title: 42, points: [] });
    const model = scriptedModel([bad, bad, bad, bad]);
    const llm = createLlm({ ...base, model, mode: "native" });

    const error = await llm
      .generateObject({ system: SYSTEM, prompt: PROMPT, schema })
      .catch((e) => e);

    expect(error).toBeInstanceOf(LlmOutputError);
    expect(error.message).not.toContain(PROMPT);
    // One native call plus the prompt path's first attempt and two repairs.
    expect(model.doGenerateCalls).toHaveLength(4);
    expect(error.usage).toEqual({ inputTokens: 40, outputTokens: 20 });
  });

  it("does not fall back on a server error and wraps it without request details", async () => {
    const serverError = new APICallError({
      message: "upstream exploded",
      url: `https://llm.example.com/v1/chat/completions?key=${API_KEY}`,
      requestBodyValues: { messages: [{ role: "user", content: PROMPT }] },
      statusCode: 503,
      responseBody: "upstream exploded",
      isRetryable: false,
    });
    const model = scriptedModel([serverError]);
    const llm = createLlm({ ...base, model, mode: "native" });

    const error = await llm
      .generateObject({ system: SYSTEM, prompt: PROMPT, schema })
      .catch((e) => e);

    expect(error).toBeInstanceOf(LlmOutputError);
    expect(error.message).toContain("503");
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain("llm.example.com");
    expect(error.message).not.toContain(PROMPT);
    expect(error.cause).toBeUndefined();
    expect(error.usage).toEqual({ inputTokens: null, outputTokens: null });
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});

describe("createLlm prompt mode", () => {
  it("appends the JSON Schema and instruction to the system prompt and parses fenced JSON", async () => {
    const model = scriptedModel([
      `好的：\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\n以上是結果`,
    ]);
    const llm = createLlm({ ...base, model, mode: "prompt" });

    const result = await llm.generateObject({ system: SYSTEM, prompt: PROMPT, schema });

    expect(result.object).toEqual(good);
    const call = callAt(model, 0);
    expect(call.responseFormat?.type).not.toBe("json");
    const system = messageText(call, "system");
    expect(system).toContain(SYSTEM);
    expect(system).toContain(JSON.stringify(z.toJSONSchema(schema, { io: "input" })));
    expect(system).toContain("只輸出一個 JSON 物件，不要其他文字");
    expect(messageText(call, "user")).toBe(PROMPT);
  });

  it("repairs schema-invalid JSON by appending the Zod issues to the prompt", async () => {
    const model = scriptedModel([JSON.stringify({ title: 42, points: [] }), JSON.stringify(good)]);
    const llm = createLlm({ ...base, model, mode: "prompt" });

    const result = await llm.generateObject({ system: SYSTEM, prompt: PROMPT, schema });

    expect(result).toEqual({ object: good, usage: { inputTokens: 20, outputTokens: 10 } });
    expect(model.doGenerateCalls).toHaveLength(2);
    const repairPrompt = messageText(callAt(model, 1), "user");
    expect(repairPrompt).toContain(PROMPT);
    expect(repairPrompt).toContain("title");
    expect(repairPrompt).toContain("expected string");
    expect(repairPrompt).toContain("points");
  });

  it("repairs output that holds no JSON object", async () => {
    const model = scriptedModel(["抱歉，我做不到。", JSON.stringify(good)]);
    const llm = createLlm({ ...base, model, mode: "prompt" });

    await expect(llm.generateObject({ system: SYSTEM, prompt: PROMPT, schema })).resolves.toEqual(
      expect.objectContaining({ object: good }),
    );
    expect(messageText(callAt(model, 1), "user")).toContain("JSON");
  });

  it("throws LlmOutputError without prompt or key after maxRepairs failed repairs", async () => {
    const bad = JSON.stringify({ title: 42, points: [] });
    const model = scriptedModel([bad, bad, bad]);
    const llm = createLlm({ ...base, model, mode: "prompt" });

    const error = await llm
      .generateObject({ system: SYSTEM, prompt: PROMPT, schema })
      .catch((e) => e);

    expect(error).toBeInstanceOf(LlmOutputError);
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(error.usage).toEqual({ inputTokens: 30, outputTokens: 15 });
    expect(error.message).not.toContain(PROMPT);
    expect(error.message).not.toContain(SYSTEM);
    expect(error.message).not.toContain(API_KEY);
  });

  it("honours a custom maxRepairs and bounds the output excerpt", async () => {
    const long = `{"title": 42, "points": [], "pad": "${"x".repeat(1000)}"}`;
    const model = scriptedModel([long]);
    const llm = createLlm({ ...base, model, mode: "prompt" });

    const error = await llm
      .generateObject({ system: SYSTEM, prompt: PROMPT, schema, maxRepairs: 0 })
      .catch((e) => e);

    expect(error).toBeInstanceOf(LlmOutputError);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(error.message).not.toContain("x".repeat(201));
  });
});

describe("createLlm timeouts", () => {
  it("passes the timeout to the request and surfaces an abort as LlmOutputError", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    const model = scriptedModel([JSON.stringify(good)]);
    const llm = createLlm({ ...base, model, mode: "native" });

    const error = await llm
      .generateObject({ system: SYSTEM, prompt: PROMPT, schema })
      .catch((e) => e);

    expect(timeout).toHaveBeenCalledWith(5000);
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(error.message).not.toContain(PROMPT);
  });
});

describe("createLlmFromEnv", () => {
  it.each(["responses", "chat"] as const)("builds a %s model without network access", (api) => {
    const llm = createLlmFromEnv({
      LLM_BASE_URL: "https://llm.example.com/v1",
      LLM_API_KEY: API_KEY,
      LLM_MODEL: "model-x",
      LLM_API: api,
      LLM_STRUCTURED_OUTPUT: "prompt",
      LLM_TIMEOUT_MS: 120000,
      LLM_MAX_OUTPUT_TOKENS: 4000,
    });
    expect(llm.modelId).toBe("model-x");
    expect(JSON.stringify(llm)).not.toContain(API_KEY);
  });
});

describe("createModelFromEnv", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The path the model calls on the endpoint (the request fails; only the URL is read). */
  async function pathCalled(api: "responses" | "chat"): Promise<string> {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const model = createModelFromEnv({
      LLM_BASE_URL: "https://llm.example.com/v1",
      LLM_API_KEY: API_KEY,
      LLM_MODEL: "model-x",
      LLM_API: api,
    });
    await generateText({ model, prompt: "hi", maxRetries: 0 }).catch(() => {});
    return new URL(String((fetchMock.mock.calls[0] as unknown[])[0])).pathname;
  }

  it("calls /responses when LLM_API is responses", async () => {
    expect(await pathCalled("responses")).toBe("/v1/responses");
  });

  it("calls /chat/completions when LLM_API is chat", async () => {
    expect(await pathCalled("chat")).toBe("/v1/chat/completions");
  });
});
