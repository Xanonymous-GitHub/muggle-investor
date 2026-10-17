import { describe, expect, it } from "vitest";
import { type EvalEntry, formatTranscript, parseAnswerStream } from "./transcript";

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
      streamError: false,
      aborted: false,
    });
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
