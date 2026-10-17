// Pure parts of `bun run ask:eval`: reading the UI message stream of one answer and writing the
// Markdown transcript a person reads. Tool inputs and outputs are never kept, only tool names.
import type { AskNotice, AskVerification } from "../ask-message";
import { type AskQuestion, RUBRIC } from "./questions";

export type EvalAnswer = {
  text: string;
  /** Tool names in call order, one per call. */
  tools: string[];
  notices: AskNotice[];
  verification: AskVerification | null;
  streamError: boolean;
  aborted: boolean;
};

export type EvalOutcome =
  | { status: "answered"; answer: EvalAnswer }
  /** `reason` is a fixed category (an error class name), never an error message. */
  | { status: "failed"; reason: string };

export type EvalEntry = { question: AskQuestion; outcome: EvalOutcome };

export type EvalMeta = {
  date: string;
  modelId: string;
  voice: string;
  toolsMode: string;
  promptVersion: string;
};

type Chunk = { type?: unknown; [key: string]: unknown };

/** Reads the SSE body of an Ask response; unparseable lines are skipped. */
export function parseAnswerStream(body: string): EvalAnswer {
  const answer: EvalAnswer = {
    text: "",
    tools: [],
    notices: [],
    verification: null,
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

function describeAnswer(answer: EvalAnswer): string[] {
  const out: string[] = [];
  if (answer.streamError)
    out.push("**Problem:** stream error (the stream carried an error part).", "");
  if (answer.aborted) out.push("**Problem:** aborted (the stream was cut off).", "");
  out.push("**Answer:**", "", answer.text === "" ? "> (no text)" : quote(answer.text), "");
  out.push(`Tools: ${describeTools(answer.tools)}`, "");
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
    `- Questions: ${entries.length}`,
    "",
    "Read each answer, then tick the boxes that hold.",
    "",
  ];
  entries.forEach(({ question, outcome }, index) => {
    out.push(
      `## ${index + 1}. ${question.id} (${question.lens})`,
      "",
      `**Question:** ${question.text}`,
      "",
    );
    if (outcome.status === "failed") out.push(`**FAILED: ${outcome.reason}**`, "");
    else out.push(...describeAnswer(outcome.answer));
    out.push("**Rubric:**", "");
    for (const check of question.checks) out.push(`- [ ] ${check}: ${RUBRIC[check]}`);
    out.push("");
  });
  return out.join("\n");
}
