import { afterEach, describe, expect, it, vi } from "vitest";

const ENV = {
  DATABASE_URL: "postgres://user:pw@localhost:5432/db",
  DARKFANXING_KEY: "darkfanxing-key-0123456789",
  LLM_BASE_URL: "https://llm.test/v1",
  LLM_API_KEY: "llm-secret-key",
  LLM_MODEL: "m",
  CRON_SECRET: "c".repeat(32),
  INVITE_CODES: "a",
};

describe("safeErrorMessage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("scrubs both the upstream key and the LLM key", async () => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    const { safeErrorMessage } = await import("./safe-error");
    const text = safeErrorMessage(
      new Error(`GET /api/now/${ENV.DARKFANXING_KEY} with Bearer ${ENV.LLM_API_KEY}`),
    );
    expect(text).toBe("Error: GET /api/now/*** with Bearer ***");
  });

  it("falls back to the raw message when the env is invalid", async () => {
    for (const name of Object.keys(ENV)) vi.stubEnv(name, "");
    const { safeErrorMessage } = await import("./safe-error");
    expect(safeErrorMessage(new Error("boom"))).toBe("Error: boom");
  });
});
