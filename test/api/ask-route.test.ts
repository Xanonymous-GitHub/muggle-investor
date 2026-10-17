import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession, subjectFor } from "@/ask/auth/session";
import { MAX_ASK_BODY_BYTES } from "@/ask/schema";
import type { Db } from "@/db/client";
import { getAskUsage } from "@/db/repositories/ask-usage";
import { toTaipei } from "@/market-clock/market-clock";
import { createTestDb } from "../helpers/test-db";

const SECRET = "s".repeat(32);
const CODE = "alpha-code-0123456789";
const SUBJECT = subjectFor(CODE, SECRET);

let db: Db;
let model: MockLanguageModelV4;
const askModel = vi.hoisted(() => ({ fail: null as Error | null }));
vi.mock("@/server/services", () => ({
  getDb: () => db,
  getAskModel: () => {
    if (askModel.fail) throw askModel.fail;
    return { model, modelId: "fake-model" };
  },
}));

const env = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/env")>()),
  getEnv: () => env.value,
}));
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: log }));

const { POST } = await import("../../app/api/ask/route");
const { resetToolSupport } = await import("@/ask/ask-service");

const VALID = {
  lens: "beginner",
  messages: [{ role: "user", content: "SENTINEL_QUESTION 市場怎麼樣？" }],
};

function textModel(text: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] });
          c.enqueue({ type: "text-start", id: "t" });
          c.enqueue({ type: "text-delta", id: "t", delta: text });
          c.enqueue({ type: "text-end", id: "t" });
          c.enqueue({
            type: "finish",
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 5, text: 5, reasoning: undefined },
            },
            finishReason: { unified: "stop", raw: "stop" },
          });
          c.close();
        },
      }),
    }),
  });
}

const cookie = (subjectCode = CODE) =>
  `${SESSION_COOKIE}=${signSession({ subject: subjectFor(subjectCode, SECRET), now: new Date() }, SECRET)}`;

const post = (body: string, headers: Record<string, string> = { cookie: cookie() }) =>
  POST(
    new Request("http://x/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );

const day = () => toTaipei(new Date()).date;
const used = async () => (await getAskUsage(db, SUBJECT, day())).messages;

beforeEach(async () => {
  db = await createTestDb();
  model = textModel("你好。");
  askModel.fail = null;
  env.value = {
    AUTH_SECRET: SECRET,
    INVITE_CODES: [CODE],
    ASK_VOICE: "analyst",
    ASK_TOOLS: "on",
    ASK_MCP_SERVERS: [],
    ASK_DAILY_MESSAGE_LIMIT: 2,
    ASK_MAX_STEPS: 4,
    ASK_TOOL_TIMEOUT_MS: 2000,
    ASK_MAX_OUTPUT_TOKENS: 500,
    LLM_TIMEOUT_MS: 10_000,
    LLM_MODEL: "fake-model",
  };
  for (const fn of Object.values(log)) fn.mockReset();
  resetToolSupport();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/ask", () => {
  it("rejects a request without a session with 401 and takes no quota", async () => {
    const res = await post(JSON.stringify(VALID), {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("rejects a cookie for a code that is no longer configured", async () => {
    const res = await post(JSON.stringify(VALID), { cookie: cookie("removed-code") });
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON with 400 and takes no quota", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await used()).toBe(0);
  });

  it("rejects a schema-invalid body with only the error code (no issues, no input echoed)", async () => {
    const res = await post(
      JSON.stringify({ lens: "SENTINEL_LENS", messages: [{ role: "user", content: "x" }] }),
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "invalid_request" });
    expect(text).not.toContain("SENTINEL_LENS");
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("SENTINEL_LENS");
    expect(await used()).toBe(0);
  });

  it("rejects a body over the cap with 413 and takes no quota", async () => {
    const big = JSON.stringify({ ...VALID, pad: "x".repeat(MAX_ASK_BODY_BYTES + 1024) });
    const res = await post(big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
    expect(await used()).toBe(0);
  });

  it("streams an accepted request as a UI message stream and counts it once", async () => {
    const res = await post(JSON.stringify(VALID));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("你好。");
    expect(body).toContain("data-verification");
    expect(await used()).toBe(1);
    expect(JSON.stringify(Object.values(log).flatMap((fn) => fn.mock.calls))).not.toContain(
      "SENTINEL_QUESTION",
    );
  });

  it("answers 429 with retry-after to the next Taipei midnight once the day's quota is spent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 2026-10-17 22:00 Taipei: two hours to midnight.
    vi.setSystemTime(new Date("2026-10-17T14:00:00Z"));
    expect((await post(JSON.stringify(VALID))).status).toBe(200);
    expect((await post(JSON.stringify(VALID))).status).toBe(200);
    const calls = model.doStreamCalls.length;
    const res = await post(JSON.stringify(VALID));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(res.headers.get("retry-after")).toBe(String(2 * 60 * 60));
    expect(res.headers.get("x-ask-limit")).toBe("2");
    expect(res.headers.get("x-ask-used")).toBe("2");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(model.doStreamCalls).toHaveLength(calls);
    expect(await used()).toBe(2);
  });

  it("maps a model that fails before any output to 503 llm_unavailable", async () => {
    model = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({
          message: "SENTINEL_PROVIDER down",
          url: "http://llm.invalid",
          requestBodyValues: {},
          statusCode: 502,
          isRetryable: false,
        });
      },
    });
    const res = await post(JSON.stringify(VALID));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "llm_unavailable" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("SENTINEL_PROVIDER");
    // Our failure, not the user's: the day's message is given back.
    expect(await used()).toBe(0);
  });

  it("does not refund a 500", async () => {
    askModel.fail = new Error("boom");
    expect((await post(JSON.stringify(VALID))).status).toBe(500);
    expect(await used()).toBe(1);
  });

  it("maps anything else to 500 internal_error and logs no request content", async () => {
    askModel.fail = new Error("SENTINEL_FAILURE with SENTINEL_QUESTION");
    const res = await post(JSON.stringify(VALID));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(log.error).toHaveBeenCalled();
    const logged = JSON.stringify(Object.values(log).flatMap((fn) => fn.mock.calls));
    expect(logged).not.toContain("SENTINEL_QUESTION");
    expect(logged).not.toContain("SENTINEL_FAILURE");
  });
});
