import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLogLevel } from "./logger";

describe("resolveLogLevel", () => {
  it.each([
    [undefined, "info"],
    ["", "info"],
    ["verbose", "info"],
    ["debug", "debug"],
    ["silent", "silent"],
  ])("maps LOG_LEVEL %j to %s", (raw, expected) => {
    expect(resolveLogLevel(raw)).toBe(expected);
  });
});

describe("logger module", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(["", "verbose"])("imports with LOG_LEVEL=%j and falls back to info", async (raw) => {
    vi.stubEnv("LOG_LEVEL", raw);
    vi.resetModules();
    const { logger } = await import("./logger");
    expect(logger.level).toBe("info");
  });
});
