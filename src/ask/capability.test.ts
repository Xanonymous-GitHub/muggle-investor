import { beforeEach, describe, expect, it } from "vitest";
import {
  capabilityKey,
  rememberToolsRejected,
  resetToolSupport,
  TOOLS_REJECTION_TTL_MS,
  toolsRecentlyRejected,
} from "./capability";

const ENV = {
  LLM_API: "responses",
  LLM_BASE_URL: "https://llm.example.com/v1/",
  LLM_MODEL: "model-a",
} as const;

describe("capabilityKey", () => {
  it("names the API flavour, the endpoint and the model, and nothing secret", () => {
    expect(capabilityKey(ENV)).toBe("responses|https://llm.example.com/v1|model-a");
    expect(
      capabilityKey({
        ...ENV,
        LLM_BASE_URL: "https://user:hunter2@llm.example.com/v1?api_key=SECRET#frag",
      }),
    ).toBe("responses|https://llm.example.com/v1|model-a");
  });

  it("differs when any of the three differs", () => {
    const keys = new Set([
      capabilityKey(ENV),
      capabilityKey({ ...ENV, LLM_API: "chat" }),
      capabilityKey({ ...ENV, LLM_MODEL: "model-b" }),
      capabilityKey({ ...ENV, LLM_BASE_URL: "https://other.example.com/v1" }),
    ]);
    expect(keys.size).toBe(4);
  });

  it("still keys an unparseable base URL", () => {
    expect(capabilityKey({ ...ENV, LLM_BASE_URL: "not a url" })).toBe(
      "responses|not a url|model-a",
    );
  });
});

describe("remembered tool rejection", () => {
  beforeEach(resetToolSupport);

  it("applies to the endpoint that rejected tools and no other", () => {
    const a = capabilityKey(ENV);
    const b = capabilityKey({ ...ENV, LLM_MODEL: "model-b" });
    const c = capabilityKey({ ...ENV, LLM_API: "chat" });
    rememberToolsRejected(a, 1_000);
    expect(toolsRecentlyRejected(a, 2_000)).toBe(true);
    expect(toolsRecentlyRejected(b, 2_000)).toBe(false);
    expect(toolsRecentlyRejected(c, 2_000)).toBe(false);
  });

  it("expires after the TTL, measured on the request's own clock", () => {
    rememberToolsRejected("k", 1_000);
    expect(toolsRecentlyRejected("k", 1_000 + TOOLS_REJECTION_TTL_MS - 1)).toBe(true);
    expect(toolsRecentlyRejected("k", 1_000 + TOOLS_REJECTION_TTL_MS)).toBe(false);
    // Expired entries are gone, not merely ignored.
    expect(toolsRecentlyRejected("k", 1_001)).toBe(false);
  });
});
