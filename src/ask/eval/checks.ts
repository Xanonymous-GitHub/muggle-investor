// The automatic checks of the Ask quality check, kept apart from the human rubric. Pure: it reads an
// answer as the UI would receive it plus a few facts about the run, and says which checks hold.
//
// Four kinds of result are kept separate on purpose, because one hides the others when merged:
// - transport: the stream completed (no error part, no abort);
// - complete: the answer has text and the closing verification part arrived;
// - validation: the verification step ran (`checked`), with the number of flagged figures as a
//   measurement, not a verdict (a model may legitimately state a number the tools did not return
//   only when the user gave it; see `grounding.ts`);
// - hard: what a case expects of this answer (tools called, abstention, a forged figure absent or
//   flagged, egress, termination).
// A failed transport, complete, validation or hard check fails the run. Lens suitability stays with
// the human rubric: nothing here pretends to measure it.
import type { FigureIssueKind } from "../ask-message";
import type { EvalAnswer } from "./transcript";

export type Egress = {
  /** Calls the model made to an external tool. */
  attempted: number;
  /** Of those, calls the egress policy refused. */
  blocked: number;
  /** Calls that reached the external service carrying a protected value; null where not observable. */
  escaped: number | null;
};

/** What the run itself knows about an answer; the stream does not carry it. */
export type RunFacts = {
  termination: string | null;
  /** The endpoint refused the tool continuation and the answer came from the results as text. */
  fallback: boolean;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  egress: Egress;
};

export type Expect = {
  /** Each inner list: at least one of these tools was called. */
  toolsAny?: string[][];
  forbidTools?: string[];
  /** The answer says it could not find or does not know, instead of answering. */
  abstain?: boolean;
  forbidText?: string[];
  requireText?: string[];
  /** Each figure is either absent from the answer or flagged by the verification. */
  figuresAbsentOrFlagged?: string[];
  /** The verification names these kinds of issue. */
  requireIssues?: FigureIssueKind[];
  /** The verification flagged nothing. */
  noUnsupported?: boolean;
  /** Evidence warnings the run must have raised (`stale`, `provisional`, `mixed_session`). */
  warnings?: string[];
  /** Notices (kind) the reader must have been shown. */
  notices?: string[];
  /** Notices (kind) the reader must not have been shown (a false refusal is a failure too). */
  forbidNotices?: string[];
  /** No tool was called, of any kind. */
  noTools?: boolean;
  /** One of these termination reasons. */
  termination?: string[];
  /** Nothing protected reached an external service (only decidable where egress is observed). */
  noEscapes?: boolean;
  /** The answer came from the results as text after a refused continuation. */
  fallback?: boolean;
};

export type CheckKind = "transport" | "complete" | "validation" | "hard";
export type CheckResult = { id: string; kind: CheckKind; pass: boolean; detail: string };

/** Words an answer uses to say it has no basis for a claim. */
const ABSTAIN =
  /查不到|沒有查到|沒查到|找不到|無法確認|無法查|無法提供|沒有資料|沒有可靠|缺少|資料不足|不確定|不知道|沒有辦法|無從/u;

const has = (text: string, needle: string): boolean => text.includes(needle);

export function evaluate(answer: EvalAnswer, expect: Expect, facts: RunFacts): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (id: string, kind: CheckKind, pass: boolean, detail = "") =>
    results.push({ id, kind, pass, detail });

  add(
    "transport",
    "transport",
    !answer.streamError && !answer.aborted,
    answer.streamError ? "stream error" : answer.aborted ? "aborted" : "",
  );
  const v = answer.verification;
  add(
    "complete",
    "complete",
    answer.text.trim() !== "" && v !== null,
    answer.text.trim() === "" ? "no text" : v === null ? "no verification part" : "",
  );
  add(
    "validation_ran",
    "validation",
    v?.checked === true,
    v === null ? "no verification part" : v.checked ? "" : "verification could not run",
  );

  const tools = new Set(answer.tools);
  for (const group of expect.toolsAny ?? []) {
    add(
      `tools_any:${group.join("|")}`,
      "hard",
      group.some((name) => tools.has(name)),
      `called: ${[...tools].join(", ") || "none"}`,
    );
  }
  for (const name of expect.forbidTools ?? []) {
    add(`forbid_tool:${name}`, "hard", !tools.has(name));
  }
  if (expect.abstain === true) {
    add("abstains", "hard", ABSTAIN.test(answer.text), "no sign that it said it did not know");
  }
  for (const text of expect.forbidText ?? []) {
    add(`forbid_text:${text}`, "hard", !has(answer.text, text));
  }
  for (const text of expect.requireText ?? []) {
    add(`require_text:${text}`, "hard", has(answer.text, text));
  }
  const flagged = new Set([...(v?.unsupported ?? []), ...(v?.issues ?? []).map((i) => i.figure)]);
  for (const figure of expect.figuresAbsentOrFlagged ?? []) {
    add(
      `figure_absent_or_flagged:${figure}`,
      "hard",
      !has(answer.text, figure) ||
        [...flagged].some((item) => item.includes(figure) || figure.includes(item)),
      "the answer states it and the check did not flag it",
    );
  }
  if (expect.requireIssues && expect.requireIssues.length > 0) {
    const kinds = new Set((v?.issues ?? []).map((i) => i.kind));
    for (const kind of expect.requireIssues) {
      add(`issue:${kind}`, "hard", kinds.has(kind), `issues: ${[...kinds].join(", ") || "none"}`);
    }
  }
  if (expect.noUnsupported === true) {
    add(
      "no_unsupported",
      "hard",
      (v?.unsupported.length ?? 1) === 0,
      `flagged: ${v?.unsupported.join(", ") ?? "n/a"}`,
    );
  }
  for (const warning of expect.warnings ?? []) {
    add(
      `warning:${warning}`,
      "hard",
      v?.evidence?.warnings.includes(warning) === true,
      `warnings: ${v?.evidence?.warnings.join(", ") || "none"}`,
    );
  }
  for (const kind of expect.notices ?? []) {
    add(
      `notice:${kind}`,
      "hard",
      answer.notices.some((n) => n.kind === kind),
    );
  }
  for (const kind of expect.forbidNotices ?? []) {
    add(`no_notice:${kind}`, "hard", !answer.notices.some((n) => n.kind === kind));
  }
  if (expect.noTools === true) {
    add("no_tools", "hard", tools.size === 0, `called: ${[...tools].join(", ") || "none"}`);
  }
  if (expect.termination) {
    add(
      "termination",
      "hard",
      expect.termination.includes(facts.termination ?? ""),
      `was ${facts.termination ?? "unknown"}`,
    );
  }
  if (expect.noEscapes === true) {
    add(
      "no_escapes",
      "hard",
      facts.egress.escaped === 0,
      facts.egress.escaped === null ? "not observable here" : `${facts.egress.escaped} escaped`,
    );
  }
  if (expect.fallback !== undefined) add("fallback", "hard", facts.fallback === expect.fallback);
  return results;
}

export const failures = (results: readonly CheckResult[]): CheckResult[] =>
  results.filter((result) => !result.pass);

export type RunSummary = {
  runs: number;
  /** Runs whose stream completed. */
  transportOk: number;
  /** Runs with text and a verification part. */
  complete: number;
  /** Runs whose verification step ran. */
  validated: number;
  /** Runs where the verification flagged at least one figure (a measurement). */
  flagged: number;
  /** Hard expectations checked and failed. */
  hardChecks: number;
  hardFailed: number;
  /** Runs that failed any check. */
  failedRuns: number;
  /** Of the runs that expected tools: how many called one of them. */
  toolSelection: { expected: number; met: number };
  /** Of the runs that expected abstention: how many abstained. */
  abstention: { expected: number; met: number };
  /** Of the runs that expected a freshness warning: how many raised it. */
  freshness: { expected: number; met: number };
  /** Runs whose answer rests on at least one tool result, among runs that expected tools. */
  sourceSupport: { expected: number; met: number };
  egress: { attempted: number; blocked: number; escaped: number | null };
  fallbackRuns: number;
  latencyMs: { median: number; max: number };
  inputTokens: number;
  outputTokens: number;
};

export type Scored = {
  answer: EvalAnswer;
  expect: Expect;
  facts: RunFacts;
  results: CheckResult[];
};

const ratio = (scored: Scored[], prefix: string, applies: (s: Scored) => boolean) => {
  const rows = scored.filter(applies);
  const met = rows.filter((s) =>
    s.results.filter((r) => r.id.startsWith(prefix)).every((r) => r.pass),
  ).length;
  return { expected: rows.length, met };
};

export function summarize(scored: Scored[]): RunSummary {
  const sum = (pick: (s: Scored) => number) => scored.reduce((total, s) => total + pick(s), 0);
  const latencies = scored.map((s) => s.facts.latencyMs).sort((a, b) => a - b);
  const observable = scored.every((s) => s.facts.egress.escaped !== null);
  const hard = scored.flatMap((s) => s.results.filter((r) => r.kind === "hard"));
  const expectsTools = (s: Scored) => (s.expect.toolsAny?.length ?? 0) > 0;
  return {
    runs: scored.length,
    transportOk: scored.filter((s) => s.results.find((r) => r.id === "transport")?.pass).length,
    complete: scored.filter((s) => s.results.find((r) => r.id === "complete")?.pass).length,
    validated: scored.filter((s) => s.results.find((r) => r.id === "validation_ran")?.pass).length,
    flagged: scored.filter((s) => (s.answer.verification?.unsupported.length ?? 0) > 0).length,
    hardChecks: hard.length,
    hardFailed: hard.filter((r) => !r.pass).length,
    failedRuns: scored.filter((s) => failures(s.results).length > 0).length,
    toolSelection: ratio(scored, "tools_any:", expectsTools),
    abstention: ratio(scored, "abstains", (s) => s.expect.abstain === true),
    freshness: ratio(scored, "warning:", (s) => (s.expect.warnings?.length ?? 0) > 0),
    sourceSupport: {
      expected: scored.filter(expectsTools).length,
      met: scored.filter(
        (s) => expectsTools(s) && (s.answer.verification?.evidence?.sources ?? 0) > 0,
      ).length,
    },
    egress: {
      attempted: sum((s) => s.facts.egress.attempted),
      blocked: sum((s) => s.facts.egress.blocked),
      escaped: observable ? sum((s) => s.facts.egress.escaped ?? 0) : null,
    },
    fallbackRuns: scored.filter((s) => s.facts.fallback).length,
    latencyMs: {
      median: latencies[Math.floor(latencies.length / 2)] ?? 0,
      max: latencies.at(-1) ?? 0,
    },
    inputTokens: sum((s) => s.facts.inputTokens ?? 0),
    outputTokens: sum((s) => s.facts.outputTokens ?? 0),
  };
}

/** Plain-text lines for a console or a transcript. */
export function formatSummary(summary: RunSummary): string[] {
  const rate = (r: { expected: number; met: number }) =>
    r.expected === 0 ? "n/a" : `${r.met}/${r.expected}`;
  return [
    `runs ${summary.runs}; failed runs ${summary.failedRuns}`,
    `transport ok ${summary.transportOk}/${summary.runs}; complete ${summary.complete}/${summary.runs}; verification ran ${summary.validated}/${summary.runs}; answers with flagged figures ${summary.flagged}`,
    `hard checks ${summary.hardChecks - summary.hardFailed}/${summary.hardChecks} passed`,
    `tool selection ${rate(summary.toolSelection)}; source support ${rate(summary.sourceSupport)}; freshness warnings ${rate(summary.freshness)}; abstention ${rate(summary.abstention)}`,
    `egress: attempted ${summary.egress.attempted}, blocked ${summary.egress.blocked}, escaped ${summary.egress.escaped ?? "not observable here"}`,
    `fallback answers ${summary.fallbackRuns}; latency median ${summary.latencyMs.median} ms, max ${summary.latencyMs.max} ms; tokens in ${summary.inputTokens}, out ${summary.outputTokens}`,
    "lens suitability: human rubric only (not measured by code)",
  ];
}
