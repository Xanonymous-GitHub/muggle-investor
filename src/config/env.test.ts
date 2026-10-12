import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  DARKFANXING_KEY: "k".repeat(20),
  LLM_BASE_URL: "https://llm.example.com/v1",
  LLM_API_KEY: "llm-key",
  LLM_MODEL: "model-x",
  CRON_SECRET: "c".repeat(32),
  INVITE_CODES: "a,b",
};

describe("parseEnv", () => {
  it("returns typed values and splits INVITE_CODES", () => {
    const env = parseEnv(valid);
    expect(env.INVITE_CODES).toEqual(["a", "b"]);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.FINMIND_TOKEN).toBeUndefined();
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
});
