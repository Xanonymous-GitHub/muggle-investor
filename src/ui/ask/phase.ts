// What state an answer is in, as two separate questions: how the request went (`phaseOf`) and
// what the run found to check the answer against (`evidenceStatusOf`). Neither implies the
// other: a complete answer can rest on no sources, and a timed-out one can have sources.
// Pure: the message, the status line and the tests all read these.
import type { ToolRun, Turn } from "@/ui/ask/use-ask-chat";

/**
 * `waiting`: sent, nothing back yet. `tools`: a tool call is running. `generating`: text is
 * arriving. The rest are settled: `complete`, `stopped` (the person pressed stop), `timeout` (the
 * server's time limit, even when a `finish` followed it), `withheld` (the output guard cut it),
 * `failed` (the connection or the model broke off), `unknown` (kept by an older version, which did
 * not record how it ended).
 */
export type Phase =
  | "waiting"
  | "tools"
  | "generating"
  | "complete"
  | "stopped"
  | "timeout"
  | "withheld"
  | "failed"
  | "unknown";

export function phaseOf(turn: Turn): Phase {
  if (turn.streaming) {
    if (turn.tools.some((tool) => tool.state === "running")) return "tools";
    return turn.text === "" ? "waiting" : "generating";
  }
  if (turn.failed) return "failed";
  if (turn.stopped) return "stopped";
  if (turn.timedOut) return "timeout";
  if (turn.notices.some((notice) => notice.kind === "withheld")) return "withheld";
  if (turn.statusUnknown === true) return "unknown";
  return "complete";
}

/** The answer ended as the model meant it to: not cut short by the person, a limit or a failure. */
export const isComplete = (turn: Turn): boolean => phaseOf(turn) === "complete" && turn.text !== "";

/** Settled, but with only part of the answer, or an unknown part. */
export const isIncomplete = (turn: Turn): boolean => {
  const phase = phaseOf(turn);
  return phase === "stopped" || phase === "timeout" || phase === "withheld" || phase === "failed";
};

/**
 * What the run found to check the answer against.
 * `pending`: the check has not arrived (the answer is still running). `unavailable`: the answer
 * ended with no check (stopped, broke off, or kept without one). `unchecked`: the check could not
 * run. `unknown`: the check ran but the server sent no source details. `none`: it ran and no tool
 * returned data. `partial`: some tool failed, or data was cut or not current. `sources`: tools
 * returned data. None of these says the answer's statements were verified.
 */
export type EvidenceStatus =
  | "pending"
  | "unavailable"
  | "unchecked"
  | "unknown"
  | "none"
  | "partial"
  | "sources";

export function evidenceStatusOf(turn: Turn): EvidenceStatus {
  const verification = turn.verification;
  if (verification === null) return turn.streaming ? "pending" : "unavailable";
  if (!verification.checked) return "unchecked";
  const evidence = verification.evidence;
  if (evidence === undefined) return "unknown";
  if (evidence.sources === 0) return "none";
  const limited =
    evidence.failed.length > 0 ||
    evidence.truncated ||
    evidence.warnings.some((w) => w === "stale" || w === "provisional" || w === "mixed_session");
  return limited ? "partial" : "sources";
}

export type ToolCounts = {
  running: ToolRun[];
  succeeded: number;
  failed: number;
  denied: number;
};

export function countTools(tools: readonly ToolRun[]): ToolCounts {
  const counts: ToolCounts = { running: [], succeeded: 0, failed: 0, denied: 0 };
  for (const tool of tools) {
    if (tool.state === "running") counts.running.push(tool);
    else counts[tool.state] += 1;
  }
  return counts;
}
