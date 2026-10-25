import { describe, expect, it, vi } from "vitest";
import { createRunRecorder } from "./run-facts";
import type { EvalAnswer } from "./transcript";

const answer = (tools: string[], blocked = 0): EvalAnswer => ({
  text: "x",
  tools,
  notices: [],
  verification: null,
  blockedToolCalls: blocked,
  streamError: false,
  aborted: false,
});

describe("createRunRecorder", () => {
  it("reads the termination reason and tokens from the service's own log line", () => {
    const recorder = createRunRecorder();
    recorder.logger.info(
      { termination: "tool_limit", inputTokens: 120, outputTokens: 30 },
      "ask answered",
    );
    expect(recorder.facts(answer([]), 42, null)).toMatchObject({
      termination: "tool_limit",
      inputTokens: 120,
      outputTokens: 30,
      latencyMs: 42,
      fallback: false,
    });
  });

  it("notes a fallback answer from the warning the service writes", () => {
    const recorder = createRunRecorder();
    recorder.logger.warn(
      {},
      "ask endpoint cannot continue after a tool call; answering from the results as text",
    );
    expect(recorder.facts(answer([]), 1, null).fallback).toBe(true);
  });

  it("counts only external tools as attempted egress, and reports escapes as given", () => {
    const recorder = createRunRecorder();
    const facts = recorder.facts(
      answer(["lookupTerm", "search__web_search", "search__web_search"], 1),
      1,
      0,
    );
    expect(facts.egress).toEqual({ attempted: 2, blocked: 1, escaped: 0 });
    expect(recorder.facts(answer([]), 1, null).egress.escaped).toBeNull();
  });

  it("knows nothing before the run ended, and forwards every line to the base logger", () => {
    const info = vi.fn();
    const recorder = createRunRecorder({ info });
    expect(recorder.facts(answer([]), 1, null)).toMatchObject({
      termination: null,
      inputTokens: null,
    });
    recorder.logger.info({ a: 1 }, "hello");
    expect(info).toHaveBeenCalledWith({ a: 1 }, "hello");
  });
});
