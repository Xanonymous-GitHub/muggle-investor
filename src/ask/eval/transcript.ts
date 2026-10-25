// Pure parts of `bun run ask:eval`: reading the UI message stream of one answer and writing the
// Markdown transcript a person reads. Tool inputs and outputs are never kept, only tool names.
import { toTaipei } from "@/market-clock/market-clock";
import type { AskNotice, AskVerification } from "../ask-message";
import type { CheckResult, RunFacts } from "./checks";
import { type AskQuestion, RUBRIC } from "./questions";

export type EvalAnswer = {
  text: string;
  /** Tool names in call order, one per call. */
  tools: string[];
  notices: AskNotice[];
  verification: AskVerification | null;
  /** How many tool calls the privacy filter blocked (the count only, never the arguments). */
  blockedToolCalls: number;
  streamError: boolean;
  aborted: boolean;
};

/** What code measured and checked on one answer (see checks.ts). */
export type EvalScore = { facts: RunFacts; results: CheckResult[] };

export type EvalOutcome =
  | { status: "answered"; answer: EvalAnswer; score?: EvalScore }
  /** `reason` is a fixed category (an error class name), never an error message. */
  | { status: "failed"; reason: string };

export type EvalEntry = { question: AskQuestion; outcome: EvalOutcome };

export type EvalMeta = {
  date: string;
  modelId: string;
  voice: string;
  toolsMode: string;
  promptVersion: string;
  /** The input gate: `on`, `strict` or `off`, and the model that classifies. */
  guard?: string;
  /** Which code produced the answers; null where it could not be read. */
  commit?: string | null;
  /** The provider API the model was reached through. */
  api?: string;
  /** The market dates the data behind the answers carried. */
  dataDates?: string;
  /** `formatSummary` lines. */
  summary?: string[];
};

type Chunk = { type?: unknown; [key: string]: unknown };

/** Reads the SSE body of an Ask response; unparseable lines are skipped. */
export function parseAnswerStream(body: string): EvalAnswer {
  const answer: EvalAnswer = {
    text: "",
    tools: [],
    notices: [],
    verification: null,
    blockedToolCalls: 0,
    streamError: false,
    aborted: false,
  };
  const seenCalls = new Set<string>();
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    let chunk: Chunk;
    try {
      chunk = JSON.parse(line.slice("data: ".length)) as Chunk;
    } catch {
      continue;
    }
    switch (chunk.type) {
      case "text-delta":
        if (typeof chunk.delta === "string") answer.text += chunk.delta;
        break;
      case "tool-input-start":
      case "tool-input-available": {
        const id = typeof chunk.toolCallId === "string" ? chunk.toolCallId : null;
        if (typeof chunk.toolName !== "string" || (id !== null && seenCalls.has(id))) break;
        if (id !== null) seenCalls.add(id);
        answer.tools.push(chunk.toolName);
        break;
      }
      case "tool-output-available": {
        const output = chunk.output as { error?: unknown } | null | undefined;
        if (typeof output === "object" && output?.error === "blocked_private_data") {
          answer.blockedToolCalls += 1;
        }
        break;
      }
      case "data-notice":
        answer.notices.push(chunk.data as AskNotice);
        break;
      case "data-verification":
        answer.verification = chunk.data as AskVerification;
        break;
      case "error":
        answer.streamError = true;
        break;
      case "abort":
        answer.aborted = true;
        break;
    }
  }
  return answer;
}

/** `loadSkill, lookupTerm x2` (sorted by name), or `none`. */
function describeTools(tools: string[]): string {
  if (tools.length === 0) return "none";
  const counts = new Map<string, number>();
  for (const name of tools) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => (n > 1 ? `${name} x${n}` : name))
    .join(", ");
}

const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");

const mark = (pass: boolean) => (pass ? "PASS" : "FAIL");

/** The four statuses kept apart, then the measurements and each failed check. */
function describeScore({ facts, results }: EvalScore): string[] {
  const of = (kind: CheckResult["kind"]) => results.filter((r) => r.kind === kind);
  const status = (kind: CheckResult["kind"]) => mark(of(kind).every((r) => r.pass));
  const hard = of("hard");
  const out = [
    `**Checks:** transport ${status("transport")}; complete ${status("complete")}; validation ${status("validation")}; hard ${hard.length === 0 ? "none set" : `${hard.filter((r) => r.pass).length}/${hard.length}`}`,
    "",
  ];
  for (const failed of results.filter((r) => !r.pass)) {
    out.push(`- FAILED ${failed.id}${failed.detail === "" ? "" : `: ${failed.detail}`}`);
  }
  if (results.some((r) => !r.pass)) out.push("");
  const { egress } = facts;
  out.push(
    `Run: termination ${facts.termination ?? "unknown"}; fallback ${facts.fallback ? "yes" : "no"}; ${facts.latencyMs} ms; tokens in ${facts.inputTokens ?? "?"} / out ${facts.outputTokens ?? "?"}`,
    "",
    `Egress: attempted ${egress.attempted}, blocked ${egress.blocked}, escaped ${egress.escaped ?? "not observable here"}`,
    "",
  );
  return out;
}

function describeAnswer(answer: EvalAnswer, score?: EvalScore): string[] {
  const out: string[] = [];
  if (answer.streamError)
    out.push("**Problem:** stream error (the stream carried an error part).", "");
  if (answer.aborted) out.push("**Problem:** aborted (the stream was cut off).", "");
  if (score) out.push(...describeScore(score));
  out.push("**Answer:**", "", answer.text === "" ? "> (no text)" : quote(answer.text), "");
  out.push(`Tools: ${describeTools(answer.tools)}`, "");
  out.push(`Blocked tool calls (privacy filter): ${answer.blockedToolCalls}`, "");
  out.push(
    answer.notices.length === 0
      ? "Notices: none"
      : `Notices: ${answer.notices.map((n) => `${n.kind} (${n.text})`).join("; ")}`,
    "",
  );
  const v = answer.verification;
  out.push(
    v === null
      ? "Verification: none (the stream ended before the check)"
      : `Verification: ${v.checked ? "checked" : "NOT checked"}; unsupported numbers: ${v.unsupported.length === 0 ? "none" : v.unsupported.join(", ")}`,
    "",
  );
  return out;
}

export function formatTranscript(meta: EvalMeta, entries: EvalEntry[]): string {
  const out: string[] = [
    `# Ask eval ${meta.date}`,
    "",
    `- Model: ${meta.modelId}`,
    `- Voice: ${meta.voice}; tools: ${meta.toolsMode}; prompt version: ${meta.promptVersion}`,
    "- Profile: sample data from scripts/ask-eval.ts (one plan request, two holdings), not a real person's.",
    ...(meta.commit !== undefined ? [`- Commit: ${meta.commit ?? "unknown"}`] : []),
    ...(meta.api ? [`- Provider API: ${meta.api}`] : []),
    ...(meta.guard ? [`- Input gate: ${meta.guard}`] : []),
    ...(meta.dataDates ? [`- Data dates: ${meta.dataDates}`] : []),
    `- Questions: ${entries.length}`,
    "",
    ...(meta.summary ? ["## Summary", "", ...meta.summary.map((line) => `- ${line}`), ""] : []),
    "Read each answer, then tick the boxes that hold. The checks above each answer are code's; the",
    "rubric is yours.",
    "",
  ];
  entries.forEach(({ question, outcome }, index) => {
    out.push(
      `## ${index + 1}. ${question.id} (${question.lens})`,
      "",
      ...(question.history
        ? [
            "**Earlier turns (sent as the client's history):**",
            "",
            ...question.history.map((turn) => quote(`${turn.role}: ${turn.content}`)),
            "",
          ]
        : []),
      `**Question:** ${question.text}`,
      "",
    );
    if (outcome.status === "failed") out.push(`**FAILED: ${outcome.reason}**`, "");
    else out.push(...describeAnswer(outcome.answer, outcome.score));
    out.push("**Rubric:**", "");
    for (const check of question.checks) out.push(`- [ ] ${check}: ${RUBRIC[check]}`);
    out.push("");
  });
  return out.join("\n");
}

/**
 * Where a run's transcript goes: the Taipei date and time to the second, so a second run on the
 * same day does not overwrite the first.
 */
export function transcriptFileName(now: Date): string {
  const { date, minutes } = toTaipei(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}${pad(now.getUTCSeconds())}`;
  return `./ask-eval-${date}-${time}.md`;
}
