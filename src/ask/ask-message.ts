// Wire types of the POST /api/ask response stream (AI SDK UI message stream). Type-only and free
// of server imports, so the chat screen can share them.
import type { UIMessage } from "ai";
import type { EvidenceSummary } from "./evidence";

/**
 * Something the reader should know about this answer. `no_web`: no external (web, MCP) tools this
 * turn; `tool_failed`: some external tool servers could not be reached; `no_tools`: the endpoint
 * rejects tool calls, so the answer uses no tools at all; `timeout`: the answer hit the time limit
 * and stops where it got to.
 */
export type AskNotice = { kind: "no_web" | "no_tools" | "tool_failed" | "timeout"; text: string };

/**
 * Why a figure in the answer is not backed by this run's evidence. `unsupported`: no evidence
 * carries it; `history_only`: only an earlier assistant message (unverified history) states it;
 * `sign`, `unit`, `metric`, `subject`, `date`: a number of the evidence has this value, but the
 * sentence reads it with the opposite direction, another unit, another metric, another instrument
 * or another date.
 */
export type FigureIssueKind =
  | "unsupported"
  | "history_only"
  | "sign"
  | "unit"
  | "metric"
  | "subject"
  | "date";

/**
 * The number check, sent as the last data part. It is advisory and covers numbers and links only:
 * an empty `unsupported` list never means the answer's statements were verified. `checked: false`
 * means the check could not run, so the lists then say nothing. Everything after `checked` is
 * optional so an older reader of the stream keeps working.
 */
export type AskVerification = {
  /** Every figure with an issue (the union of `issues`), for the inline marks. */
  unsupported: string[];
  checked: boolean;
  /** Figures only the user's own message states: not market data, not verified. */
  userStated?: string[];
  issues?: { figure: string; kind: FigureIssueKind }[];
  /** Links in the answer that no tool result of this run contained (normalized, host and path). */
  unverifiedLinks?: string[];
  /** What the run's tools returned: how many sources, which came back empty, truncation, warnings. */
  evidence?: EvidenceSummary;
};

export type AskDataParts = { notice: AskNotice; verification: AskVerification };

export type AskUIMessage = UIMessage<never, AskDataParts>;
