import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  DARKFANXING_KEY: "k".repeat(20),
  LLM_BASE_URL: "https://llm.example.com/v1",
  LLM_API_KEY: "llm-key",
  LLM_MODEL: "model-x",
  CRON_SECRET: "c".repeat(32),
  AUTH_SECRET: "s".repeat(32),
  INVITE_CODES: "a,b",
};

describe("parseEnv", () => {
  it("returns typed values and splits INVITE_CODES", () => {
    const env = parseEnv(valid);
    expect(env.INVITE_CODES).toEqual(["a", "b"]);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.FINMIND_TOKEN).toBeUndefined();
  });

  it("defaults LLM_API to responses and accepts chat", () => {
    expect(parseEnv(valid).LLM_API).toBe("responses");
    expect(parseEnv({ ...valid, LLM_API: "chat" }).LLM_API).toBe("chat");
  });

  it("rejects an unknown LLM_API", () => {
    expect(() => parseEnv({ ...valid, LLM_API: "completions" })).toThrow(EnvError);
  });

  it("defaults DARKFANXING_BASE_URL", () => {
    expect(parseEnv(valid).DARKFANXING_BASE_URL).toBe("https://stocks.darkfanxing.com");
  });

  it("names invalid keys but never values", () => {
    const badSecret = "short-secret-value";
    const { DARKFANXING_KEY: _omit, ...rest } = valid;
    let error: unknown;
    try {
      parseEnv({ ...rest, CRON_SECRET: badSecret });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    const message = (error as EnvError).message;
    expect(message).toContain("DARKFANXING_KEY");
    expect(message).toContain("CRON_SECRET");
    expect(message).not.toContain(badSecret);
  });

  it("defaults the LLM call settings", () => {
    const env = parseEnv(valid);
    expect(env.LLM_STRUCTURED_OUTPUT).toBe("native");
    expect(env.LLM_TIMEOUT_MS).toBe(120000);
    expect(env.LLM_MAX_OUTPUT_TOKENS).toBe(4000);
  });

  it("coerces numeric LLM settings and accepts prompt mode", () => {
    const env = parseEnv({
      ...valid,
      LLM_STRUCTURED_OUTPUT: "prompt",
      LLM_TIMEOUT_MS: "30000",
      LLM_MAX_OUTPUT_TOKENS: "2000",
    });
    expect(env.LLM_STRUCTURED_OUTPUT).toBe("prompt");
    expect(env.LLM_TIMEOUT_MS).toBe(30000);
    expect(env.LLM_MAX_OUTPUT_TOKENS).toBe(2000);
  });

  it("rejects an unknown LLM_STRUCTURED_OUTPUT by key name only", () => {
    let error: unknown;
    try {
      parseEnv({ ...valid, LLM_STRUCTURED_OUTPUT: "json-mode-xyz" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    expect((error as EnvError).keys).toEqual(["LLM_STRUCTURED_OUTPUT"]);
    expect((error as EnvError).message).not.toContain("json-mode-xyz");
  });

  it("rejects a non-positive LLM_TIMEOUT_MS", () => {
    expect(() => parseEnv({ ...valid, LLM_TIMEOUT_MS: "0" })).toThrow(EnvError);
  });

  it("rejects empty INVITE_CODES", () => {
    expect(() => parseEnv({ ...valid, INVITE_CODES: " , " })).toThrow(EnvError);
  });

  it("defaults the Ask settings", () => {
    const env = parseEnv(valid);
    expect(env.ASK_VOICE).toBe("analyst");
    expect(env.ASK_TOOLS).toBe("on");
    expect(env.ASK_MCP_SERVERS).toEqual([]);
    expect(env.ASK_DAILY_MESSAGE_LIMIT).toBe(30);
    expect(env.ASK_MAX_STEPS).toBe(6);
    expect(env.ASK_TOOL_TIMEOUT_MS).toBe(20000);
    expect(env.ASK_MAX_OUTPUT_TOKENS).toBe(2500);
    expect(env.ASK_TOTAL_OUTPUT_TOKENS).toBe(7500);
    expect(env.ASK_MAX_TOOL_CALLS).toBe(16);
    expect(env.ASK_TOOL_CONCURRENCY).toBe(4);
    expect(env.ASK_TOOL_RESULT_BUDGET_BYTES).toBe(49_152);
    expect(env.ASK_CONTEXT_TOKENS).toBe(48_000);
  });

  it("coerces numeric Ask settings and accepts facts_only / tools off", () => {
    const env = parseEnv({
      ...valid,
      ASK_VOICE: "facts_only",
      ASK_TOOLS: "off",
      ASK_DAILY_MESSAGE_LIMIT: "5",
      ASK_MAX_STEPS: "3",
    });
    expect(env.ASK_VOICE).toBe("facts_only");
    expect(env.ASK_TOOLS).toBe("off");
    expect(env.ASK_DAILY_MESSAGE_LIMIT).toBe(5);
    expect(env.ASK_MAX_STEPS).toBe(3);
  });

  it("requires AUTH_SECRET of at least 32 characters, naming the key but not the value", () => {
    const short = "short-auth-secret-value";
    let error: unknown;
    try {
      parseEnv({ ...valid, AUTH_SECRET: short });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    expect((error as EnvError).keys).toEqual(["AUTH_SECRET"]);
    expect((error as EnvError).message).not.toContain(short);
    const { AUTH_SECRET: _omit, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(EnvError);
  });

  it("names ASK_MCP_SERVERS when it is not valid JSON", () => {
    let error: unknown;
    try {
      parseEnv({ ...valid, ASK_MCP_SERVERS: "{not json" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    expect((error as EnvError).keys).toEqual(["ASK_MCP_SERVERS"]);
  });

  it.each([
    ["an object instead of an array", '{"name":"search"}'],
    ["a bad server name", '[{"name":"Bad-Name","url":"https://m.example.com","allow":["t"]}]'],
    ["a bad url", '[{"name":"search","url":"nope","allow":["t"]}]'],
    ["an empty allow list", '[{"name":"search","url":"https://m.example.com","allow":[]}]'],
    [
      "an unknown transport",
      '[{"name":"s","url":"https://m.example.com","transport":"ws","allow":["t"]}]',
    ],
    [
      "a header env that is not an env var name",
      '[{"name":"s","url":"https://m.example.com","headerEnv":{"Authorization":"not a var"},"allow":["t"]}]',
    ],
    [
      "duplicate server names",
      '[{"name":"s","url":"https://m.example.com","allow":["t"]},{"name":"s","url":"https://n.example.com","allow":["u"]}]',
    ],
    [
      "a server name containing __",
      '[{"name":"a__b","url":"https://m.example.com","allow":["t"]}]',
    ],
    [
      "a plain http url to a remote host",
      '[{"name":"s","url":"http://m.example.com","allow":["t"]}]',
    ],
    ["a non-http scheme", '[{"name":"s","url":"ftp://m.example.com","allow":["t"]}]'],
    [
      "a localhost look-alike over http",
      '[{"name":"s","url":"http://localhost.example.com","allow":["t"]}]',
    ],
    ...[
      "AUTH_SECRET",
      "CRON_SECRET",
      "LLM_API_KEY",
      "DATABASE_URL",
      "DARKFANXING_KEY",
      "FINMIND_TOKEN",
    ].map((name) => [
      `a header env naming the app's own ${name}`,
      `[{"name":"s","url":"https://m.example.com","headerEnv":{"Authorization":"${name}"},"allow":["t"]}]`,
    ]),
  ])("names ASK_MCP_SERVERS for %s", (_label, raw) => {
    let error: unknown;
    try {
      parseEnv({ ...valid, ASK_MCP_SERVERS: raw });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    expect((error as EnvError).keys).toEqual(["ASK_MCP_SERVERS"]);
  });

  it("parses ASK_MCP_SERVERS and fills transport and headerEnv defaults", () => {
    const env = parseEnv({
      ...valid,
      ASK_MCP_SERVERS: JSON.stringify([
        { name: "search", url: "https://mcp.example.com/mcp", allow: ["web_search"] },
        {
          name: "docs_2",
          url: "https://docs.example.com/sse",
          transport: "sse",
          headerEnv: { Authorization: "DOCS_MCP_AUTH" },
          allow: ["lookup", "fetch"],
        },
      ]),
    });
    expect(env.ASK_MCP_SERVERS).toEqual([
      {
        name: "search",
        url: "https://mcp.example.com/mcp",
        transport: "http",
        headerEnv: {},
        allow: ["web_search"],
        policy: {},
      },
      {
        name: "docs_2",
        url: "https://docs.example.com/sse",
        transport: "sse",
        headerEnv: { Authorization: "DOCS_MCP_AUTH" },
        allow: ["lookup", "fetch"],
        policy: {},
      },
    ]);
  });

  it("reads a per-tool egress policy and fills its defaults", () => {
    const env = parseEnv({
      ...valid,
      ASK_MCP_SERVERS: JSON.stringify([
        {
          name: "search",
          url: "https://mcp.example.com/mcp",
          allow: ["web_search", "quote"],
          policy: { quote: { mode: "symbol", maxChars: 10 }, web_search: { mode: "topic" } },
        },
      ]),
    });
    expect(env.ASK_MCP_SERVERS[0]?.policy).toEqual({
      quote: { mode: "symbol", maxChars: 10 },
      web_search: { mode: "topic", maxChars: 60 },
    });
  });

  it("gives free_text 200 characters by default, and a topic the 60 it can hold", () => {
    const env = parseEnv({
      ...valid,
      ASK_MCP_SERVERS: JSON.stringify([
        {
          name: "search",
          url: "https://mcp.example.com/mcp",
          allow: ["a", "b", "c"],
          policy: { a: {}, b: { mode: "topic" }, c: { mode: "topic", maxChars: 30 } },
        },
      ]),
    });
    expect(env.ASK_MCP_SERVERS[0]?.policy).toEqual({
      a: { mode: "free_text", maxChars: 200 },
      b: { mode: "topic", maxChars: 60 },
      c: { mode: "topic", maxChars: 30 },
    });
  });

  it("rejects a topic limit above 60 instead of ignoring it", () => {
    expect(() =>
      parseEnv({
        ...valid,
        ASK_MCP_SERVERS: JSON.stringify([
          {
            name: "search",
            url: "https://mcp.example.com/mcp",
            allow: ["web_search"],
            policy: { web_search: { mode: "topic", maxChars: 120 } },
          },
        ]),
      }),
    ).toThrow();
  });

  it.each([
    ["a policy for a tool that is not allowed", { other: { mode: "topic" } }],
    ["an unknown mode", { t: { mode: "anything" } }],
    ["a limit that is too large", { t: { maxChars: 5000 } }],
  ])("rejects %s", (_label, policy) => {
    expect(() =>
      parseEnv({
        ...valid,
        ASK_MCP_SERVERS: JSON.stringify([
          { name: "s", url: "https://m.example.com", allow: ["t"], policy },
        ]),
      }),
    ).toThrow(EnvError);
  });

  it.each([
    "http://localhost:3001/mcp",
    "http://127.0.0.1:3001/mcp",
    "http://[::1]:3001/mcp",
    "https://mcp.example.com/mcp",
  ])("accepts the MCP url %s", (url) => {
    const env = parseEnv({
      ...valid,
      ASK_MCP_SERVERS: JSON.stringify([{ name: "s", url, allow: ["t"] }]),
    });
    expect(env.ASK_MCP_SERVERS[0]?.url).toBe(url);
  });

  it("treats an empty ASK_MCP_SERVERS as no servers", () => {
    expect(parseEnv({ ...valid, ASK_MCP_SERVERS: "  " }).ASK_MCP_SERVERS).toEqual([]);
  });
});
