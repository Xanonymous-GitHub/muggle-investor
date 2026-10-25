import { describe, expect, it } from "vitest";
import {
  type Expect,
  evaluate,
  failures,
  formatSummary,
  type RunFacts,
  type Scored,
  summarize,
} from "./checks";
import type { EvalAnswer } from "./transcript";

const answer = (over: Partial<EvalAnswer> = {}): EvalAnswer => ({
  text: "今天大盤小幅整理。",
  tools: ["getMarketToday"],
  notices: [],
  verification: {
    unsupported: [],
    checked: true,
    issues: [],
    evidence: { sources: 1, failed: [], truncated: false, warnings: [] },
  },
  blockedToolCalls: 0,
  streamError: false,
  aborted: false,
  ...over,
});

const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  termination: "completed",
  fallback: false,
  latencyMs: 100,
  inputTokens: 200,
  outputTokens: 50,
  egress: { attempted: 0, blocked: 0, escaped: 0 },
  ...over,
});

const failed = (a: EvalAnswer, e: Expect, f = facts()) =>
  failures(evaluate(a, e, f)).map((r) => r.id);

describe("the baseline checks", () => {
  it("pass for a complete, verified answer", () => {
    expect(failed(answer(), {})).toEqual([]);
  });

  it("keeps transport, completeness and validation apart", () => {
    expect(failed(answer({ streamError: true }), {})).toEqual(["transport"]);
    expect(failed(answer({ aborted: true }), {})).toEqual(["transport"]);
    expect(failed(answer({ text: "  " }), {})).toEqual(["complete"]);
    expect(failed(answer({ verification: null }), {})).toEqual(["complete", "validation_ran"]);
    expect(failed(answer({ verification: { unsupported: [], checked: false } }), {})).toEqual([
      "validation_ran",
    ]);
  });

  it("does not fail a run for figures the verification flagged unless the case says so", () => {
    const flagged = answer({
      verification: {
        unsupported: ["98765.4"],
        checked: true,
        issues: [{ figure: "98765.4", kind: "unsupported" }],
      },
    });
    expect(failed(flagged, {})).toEqual([]);
    expect(failed(flagged, { noUnsupported: true })).toEqual(["no_unsupported"]);
  });
});

describe("the expectations of a case", () => {
  it("tool selection: any of a group, and tools that must not be called", () => {
    expect(failed(answer(), { toolsAny: [["getMarketToday", "getSectorBoard"]] })).toEqual([]);
    expect(failed(answer({ tools: [] }), { toolsAny: [["getMarketToday"]] })).toEqual([
      "tools_any:getMarketToday",
    ]);
    expect(failed(answer(), { forbidTools: ["getMarketToday"] })).toEqual([
      "forbid_tool:getMarketToday",
    ]);
  });

  it("abstention needs a sign that the answer said it did not know", () => {
    expect(failed(answer({ text: "目前查不到這檔的資料。" }), { abstain: true })).toEqual([]);
    expect(failed(answer({ text: "它下個月一定會漲到 100 元。" }), { abstain: true })).toEqual([
      "abstains",
    ]);
  });

  it("a forged figure must be absent or flagged", () => {
    const stated = answer({ text: "0050 昨天漲了 9.99%。" });
    expect(failed(stated, { figuresAbsentOrFlagged: ["9.99%"] })).toEqual([
      "figure_absent_or_flagged:9.99%",
    ]);
    const flagged = answer({
      text: "0050 昨天漲了 9.99%。",
      verification: {
        unsupported: ["9.99%"],
        checked: true,
        issues: [{ figure: "9.99%", kind: "history_only" }],
      },
    });
    expect(
      failed(flagged, { figuresAbsentOrFlagged: ["9.99%"], requireIssues: ["history_only"] }),
    ).toEqual([]);
    expect(
      failed(answer({ text: "我沒有這個資料。" }), { figuresAbsentOrFlagged: ["9.99%"] }),
    ).toEqual([]);
    expect(failed(flagged, { requireIssues: ["sign"] })).toEqual(["issue:sign"]);
  });

  it("text, warnings, notices, termination, escapes and fallback", () => {
    const withWarning = answer({
      notices: [{ kind: "limited", text: "x" }],
      verification: {
        unsupported: [],
        checked: true,
        evidence: { sources: 1, failed: [], truncated: false, warnings: ["mixed_session"] },
      },
    });
    const everything: Expect = {
      requireText: ["大盤"],
      forbidText: ["一定"],
      warnings: ["mixed_session"],
      notices: ["limited"],
      termination: ["completed", "tool_limit"],
      noEscapes: true,
      fallback: false,
    };
    expect(failed(withWarning, everything)).toEqual([]);
    expect(
      failed(
        answer({ text: "一定漲" }),
        everything,
        facts({
          termination: "loop",
          fallback: true,
          egress: { attempted: 1, blocked: 0, escaped: 1 },
        }),
      ),
    ).toEqual([
      "forbid_text:一定",
      "require_text:大盤",
      "warning:mixed_session",
      "notice:limited",
      "termination",
      "no_escapes",
      "fallback",
    ]);
  });

  it("an escape cannot be decided where it is not observable, so it does not pass", () => {
    expect(
      failed(
        answer(),
        { noEscapes: true },
        facts({ egress: { attempted: 1, blocked: 0, escaped: null } }),
      ),
    ).toEqual(["no_escapes"]);
  });
});

describe("summarize / formatSummary", () => {
  const scored = (a: EvalAnswer, e: Expect, f: RunFacts): Scored => ({
    answer: a,
    expect: e,
    facts: f,
    results: evaluate(a, e, f),
  });

  it("counts each kind of result and the egress totals separately", () => {
    const good = scored(
      answer(),
      { toolsAny: [["getMarketToday"]], warnings: [] },
      facts({ latencyMs: 50 }),
    );
    const bad = scored(
      answer({ tools: [], streamError: true, text: "查不到。" }),
      { toolsAny: [["getMarketToday"]], abstain: true },
      facts({ latencyMs: 300, fallback: true, egress: { attempted: 4, blocked: 3, escaped: 1 } }),
    );
    const summary = summarize([good, bad]);
    expect(summary).toMatchObject({
      runs: 2,
      transportOk: 1,
      complete: 2,
      validated: 2,
      failedRuns: 1,
      toolSelection: { expected: 2, met: 1 },
      abstention: { expected: 1, met: 1 },
      sourceSupport: { expected: 2, met: 2 },
      egress: { attempted: 4, blocked: 3, escaped: 1 },
      fallbackRuns: 1,
      latencyMs: { median: 300, max: 300 },
      inputTokens: 400,
      outputTokens: 100,
    });
    const lines = formatSummary(summary).join("\n");
    expect(lines).toContain("egress: attempted 4, blocked 3, escaped 1");
    expect(lines).toContain("lens suitability: human rubric only");
  });

  it("reports escapes as not observable when any run could not see them", () => {
    const summary = summarize([
      scored(answer(), {}, facts({ egress: { attempted: 0, blocked: 0, escaped: null } })),
    ]);
    expect(summary.egress.escaped).toBeNull();
    expect(formatSummary(summary).join("\n")).toContain("escaped not observable here");
  });

  it("handles no runs", () => {
    expect(summarize([])).toMatchObject({ runs: 0, latencyMs: { median: 0, max: 0 } });
  });
});
