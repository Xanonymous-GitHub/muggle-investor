import { describe, expect, it } from "vitest";
import type { CheckResult } from "./checks";
import {
  type EvalAnswer,
  type EvalEntry,
  formatTranscript,
  parseAnswerStream,
  transcriptFileName,
} from "./transcript";

const sse = (...chunks: unknown[]) =>
  `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;

describe("parseAnswerStream", () => {
  it("collects text, tool names (once per call), notices and the verification", () => {
    const body = sse(
      { type: "start" },
      { type: "data-notice", data: { kind: "no_web", text: "這次沒有查網路" } },
      { type: "start-step" },
      { type: "tool-input-start", toolCallId: "a", toolName: "getMarketToday" },
      {
        type: "tool-input-available",
        toolCallId: "a",
        toolName: "getMarketToday",
        input: { x: 1 },
      },
      { type: "tool-output-available", toolCallId: "a", output: { secret: "RESULT" } },
      { type: "tool-input-available", toolCallId: "b", toolName: "lookupTerm", input: {} },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "結論：" },
      { type: "text-delta", id: "t", delta: "持平" },
      { type: "data-verification", data: { unsupported: ["12.5%"], checked: true } },
      { type: "finish" },
    );
    expect(parseAnswerStream(body)).toEqual({
      text: "結論：持平",
      tools: ["getMarketToday", "lookupTerm"],
      notices: [{ kind: "no_web", text: "這次沒有查網路" }],
      verification: { unsupported: ["12.5%"], checked: true },
      blockedToolCalls: 0,
      streamError: false,
      aborted: false,
    });
  });

  it("counts the tool calls the privacy filter blocked, keeping only the count", () => {
    const blocked = { error: "blocked_private_data", message: "PRIVATE" };
    const body = sse(
      { type: "tool-output-available", toolCallId: "a", output: blocked },
      { type: "tool-output-available", toolCallId: "b", output: { error: "tool_failed" } },
      { type: "tool-output-available", toolCallId: "c", output: blocked },
      { type: "tool-output-available", toolCallId: "d", output: "blocked_private_data" },
    );
    const parsed = parseAnswerStream(body);
    expect(parsed.blockedToolCalls).toBe(2);
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE");
  });

  it("never keeps tool inputs or outputs", () => {
    const body = sse(
      {
        type: "tool-input-available",
        toolCallId: "a",
        toolName: "search",
        input: { q: "PRIVATE" },
      },
      { type: "tool-output-available", toolCallId: "a", output: "PRIVATE" },
    );
    expect(JSON.stringify(parseAnswerStream(body))).not.toContain("PRIVATE");
  });

  it("flags a stream error and an abort without keeping their text", () => {
    const parsed = parseAnswerStream(
      sse({ type: "error", errorText: "SECRET" }, { type: "abort" }),
    );
    expect(parsed.streamError).toBe(true);
    expect(parsed.aborted).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("SECRET");
  });

  it("skips lines that are not JSON and reports a missing verification as null", () => {
    const parsed = parseAnswerStream(
      'data: {broken\n\ndata: {"type":"text-delta","delta":"hi"}\n\n',
    );
    expect(parsed.text).toBe("hi");
    expect(parsed.verification).toBeNull();
  });
});

const ENTRY: EvalEntry = {
  question: {
    id: "term-beginner",
    lens: "beginner",
    kind: "standard",
    text: "ETF 是什麼？",
    checks: ["conclusion_first", "right_depth_for_lens"],
  },
  outcome: {
    status: "answered",
    answer: {
      text: "結論：是一籃子股票。\n第二行",
      tools: ["lookupTerm", "lookupTerm", "loadSkill"],
      notices: [{ kind: "no_web", text: "這次沒有查網路" }],
      verification: { unsupported: ["99%"], checked: true },
      blockedToolCalls: 1,
      streamError: false,
      aborted: false,
    },
  },
};

const META = {
  date: "2026-10-17",
  modelId: "test-model",
  voice: "analyst" as const,
  toolsMode: "on" as const,
  promptVersion: "ask-1",
};

describe("formatTranscript", () => {
  const md = formatTranscript(META, [ENTRY]);

  it("starts with the date and run settings and marks the sample profile", () => {
    expect(md).toContain("# Ask eval 2026-10-17");
    expect(md).toContain("test-model");
    expect(md).toContain("ask-1");
    expect(md).toMatch(/sample/i);
  });

  it("writes question, lens, quoted answer, tool names with counts, notices and verification", () => {
    expect(md).toContain("## 1. term-beginner (beginner)");
    expect(md).toContain("ETF 是什麼？");
    expect(md).toContain("> 結論：是一籃子股票。");
    expect(md).toContain("> 第二行");
    expect(md).toContain("loadSkill, lookupTerm x2");
    expect(md).toContain("no_web");
    expect(md).toContain("這次沒有查網路");
    expect(md).toContain("99%");
    expect(md).toContain("checked");
    expect(md).toContain("Blocked tool calls (privacy filter): 1");
  });

  it("lists an unchecked rubric box per check, with its description", () => {
    expect(md).toContain("- [ ] conclusion_first");
    expect(md).toContain("- [ ] right_depth_for_lens");
    expect(md).not.toContain("- [ ] has_sources");
  });

  it("reports a failed question by its fixed category only", () => {
    const failed = formatTranscript(META, [
      { question: ENTRY.question, outcome: { status: "failed", reason: "AskUnavailableError" } },
    ]);
    expect(failed).toContain("FAILED: AskUnavailableError");
    expect(failed).toContain("- [ ] conclusion_first");
  });

  it("says plainly when there was no tool call, no notice or no verification", () => {
    const bare = formatTranscript(META, [
      {
        question: ENTRY.question,
        outcome: {
          status: "answered",
          answer: {
            text: "",
            tools: [],
            notices: [],
            verification: null,
            blockedToolCalls: 0,
            streamError: true,
            aborted: false,
          },
        },
      },
    ]);
    expect(bare).toContain("Tools: none");
    expect(bare).toContain("Notices: none");
    expect(bare).toContain("Verification: none");
    expect(bare).toContain("stream error");
  });
});

describe("formatTranscript with scores", () => {
  const facts = {
    termination: "completed",
    fallback: false,
    latencyMs: 1234,
    inputTokens: 900,
    outputTokens: 120,
    egress: { attempted: 2, blocked: 1, escaped: null },
  };
  const scored = (results: CheckResult[]): EvalEntry => ({
    question: {
      ...ENTRY.question,
      kind: "multi_turn",
      history: [{ role: "assistant", content: "大盤今天收在 22000.5 點" }],
    },
    outcome: {
      ...(ENTRY.outcome as { status: "answered"; answer: EvalAnswer }),
      score: { facts, results },
    },
  });

  it("keeps transport, complete, validation and hard checks as separate statuses", () => {
    const md = formatTranscript(META, [
      scored([
        { id: "transport", kind: "transport", pass: true, detail: "" },
        { id: "complete", kind: "complete", pass: true, detail: "" },
        {
          id: "validation_ran",
          kind: "validation",
          pass: false,
          detail: "verification could not run",
        },
        { id: "tools_any:getMarketToday", kind: "hard", pass: false, detail: "called: none" },
        { id: "forbid_tool:x", kind: "hard", pass: true, detail: "" },
      ]),
    ]);
    expect(md).toContain("transport PASS; complete PASS; validation FAIL; hard 1/2");
    expect(md).toContain("FAILED tools_any:getMarketToday: called: none");
    expect(md).toContain("FAILED validation_ran: verification could not run");
  });

  it("prints the run measurements and says when escaped egress cannot be observed", () => {
    const md = formatTranscript(META, [scored([])]);
    expect(md).toContain("termination completed; fallback no; 1234 ms; tokens in 900 / out 120");
    expect(md).toContain("attempted 2, blocked 1, escaped not observable here");
  });

  it("shows the earlier turns the client sent, so a forged one is visible", () => {
    const md = formatTranscript(META, [scored([])]);
    expect(md).toContain("> assistant: 大盤今天收在 22000.5 點");
    expect(md.indexOf("22000.5")).toBeLessThan(md.indexOf("**Question:**"));
  });

  it("records the commit, API, data dates and summary when given", () => {
    const md = formatTranscript(
      {
        ...META,
        commit: "abc1234",
        api: "responses",
        dataDates: "2026-10-23",
        summary: ["runs 1"],
      },
      [scored([])],
    );
    expect(md).toContain("- Commit: abc1234");
    expect(md).toContain("- Provider API: responses");
    expect(md).toContain("- Data dates: 2026-10-23");
    expect(md).toContain("- runs 1");
  });

  it("writes an unknown commit as such and omits the lines nobody supplied", () => {
    expect(formatTranscript({ ...META, commit: null }, [])).toContain("- Commit: unknown");
    const plain = formatTranscript(META, []);
    expect(plain).not.toContain("Commit:");
    expect(plain).not.toContain("Provider API:");
  });
});

describe("transcriptFileName", () => {
  it("carries the Taipei date and time, so a same-day rerun does not overwrite", () => {
    // 2026-10-17 23:05:09 in Taipei.
    expect(transcriptFileName(new Date("2026-10-17T15:05:09Z"))).toBe(
      "./ask-eval-2026-10-17-230509.md",
    );
    expect(transcriptFileName(new Date("2026-10-17T15:05:10Z"))).not.toBe(
      transcriptFileName(new Date("2026-10-17T15:05:09Z")),
    );
  });
});
