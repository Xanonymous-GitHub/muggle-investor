import { describe, expect, it } from "vitest";
import { EnvError } from "@/config/env";
import { LlmOutputError } from "@/insight/llm";
import { describeFailure } from "./describe-failure";

describe("describeFailure", () => {
  it("never prints a model reply excerpt carried by an LlmOutputError", () => {
    const error = new LlmOutputError(
      'model output did not match the schema; output excerpt: "SECRET"',
    );
    const text = describeFailure(error);
    expect(text).toBe("LlmOutputError: model output rejected");
    expect(text).not.toContain("SECRET");
  });

  it("distinguishes a failed request from a rejected reply", () => {
    expect(describeFailure(new LlmOutputError("LLM request failed after retries: HTTP 500"))).toBe(
      "LlmOutputError: LLM request failed",
    );
    expect(describeFailure(new LlmOutputError("LLM request timed out or was aborted"))).toBe(
      "LlmOutputError: LLM request failed",
    );
  });

  it("never prints a URL with credentials from an ordinary error", () => {
    const error = new Error("connect failed: postgres://user:hunter2@db:5432/x?key=abc123");
    error.name = "PostgresError";
    const text = describeFailure(error);
    expect(text).toBe("PostgresError: unexpected error");
    expect(text).not.toMatch(/hunter2|abc123|postgres:\/\//);
  });

  it("does not trust an odd error name", () => {
    const error = new Error("x");
    error.name = "oops https://u:p@host/?key=SECRET";
    expect(describeFailure(error)).toBe("Error: unexpected error");
  });

  it("names the invalid env variables but nothing else", () => {
    expect(describeFailure(new EnvError(["LLM_BASE_URL", "LLM_API_KEY"]))).toBe(
      "EnvError: invalid environment variables: LLM_BASE_URL, LLM_API_KEY",
    );
  });

  it("handles thrown values that are not errors", () => {
    expect(describeFailure("postgres://user:hunter2@db/x")).toBe("unexpected error");
    expect(describeFailure(undefined)).toBe("unexpected error");
    expect(describeFailure({ message: "SECRET" })).toBe("unexpected error");
  });
});
