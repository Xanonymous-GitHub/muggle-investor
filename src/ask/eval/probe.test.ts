import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyFailure, formatProbe, suggestAskTools } from "./probe";

const apiError = (statusCode?: number) =>
  new APICallError({
    message: "SECRET https://llm.example/v1?key=abc",
    url: "https://llm.example/v1",
    requestBodyValues: {},
    ...(statusCode !== undefined && { statusCode }),
    responseBody: "SECRET BODY",
  });

describe("classifyFailure", () => {
  it.each([
    [400, "4xx"],
    [401, "4xx"],
    [429, "4xx"],
    [500, "5xx"],
    [503, "5xx"],
    [302, "other"],
  ])("maps HTTP %i to %s", (status, expected) => {
    expect(classifyFailure(apiError(status))).toBe(expected);
  });

  it("treats an API error without a status, or any other error, as a network failure", () => {
    expect(classifyFailure(apiError())).toBe("network");
    expect(classifyFailure(new TypeError("fetch failed"))).toBe("network");
    expect(classifyFailure("x")).toBe("network");
  });

  it("looks through a retry wrapper", () => {
    const wrapped = new RetryError({
      message: "failed",
      reason: "maxRetriesExceeded",
      errors: [apiError(503), apiError(503)],
    });
    expect(classifyFailure(wrapped)).toBe("5xx");
  });
});

describe("suggestAskTools", () => {
  it("suggests on only when both streaming and tools work", () => {
    expect(suggestAskTools({ streaming: true, tools: true })).toBe("on");
    expect(suggestAskTools({ streaming: true, tools: false })).toBe("off");
    expect(suggestAskTools({ streaming: false, tools: false })).toBe("off");
    expect(suggestAskTools({ streaming: false, tools: true })).toBe("off");
  });
});

describe("formatProbe", () => {
  it("prints ok/fail with status classes and the suggestion, and nothing else", () => {
    const lines = formatProbe({
      streaming: { ok: true, statusClass: "2xx" },
      tools: { ok: false, statusClass: "4xx" },
    });
    expect(lines).toEqual([
      "streaming: ok (2xx)",
      "tools: fail (4xx)",
      "the endpoint did not take tool definitions; ASK_TOOLS=off sends no tools at all (no data tools, no web search)",
      "suggested ASK_TOOLS=off",
    ]);
  });

  it("explains an unusable endpoint when streaming fails", () => {
    const lines = formatProbe({
      streaming: { ok: false, statusClass: "network" },
      tools: { ok: false, statusClass: "network" },
    });
    expect(lines[0]).toBe("streaming: fail (network)");
    expect(lines.at(-1)).toBe("suggested ASK_TOOLS=off");
    expect(lines.join("\n")).toMatch(/streaming/);
  });
});
