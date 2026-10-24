// Reads the `data-verification` part of the answer stream and words what it says. Pure: the
// stream consumer and the answer view import these; the rules are pinned by verification.test.ts.
import type { AskVerification, FigureIssueKind } from "@/ask/ask-message";
import { ASK_COPY } from "@/ui/ask/copy";

const ISSUE_KINDS: readonly string[] = [
  "unsupported",
  "history_only",
  "sign",
  "unit",
  "metric",
  "subject",
  "date",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * The verification a stream part carries, or null when it is malformed. Strict about the two
 * original fields, tolerant about the rest: an optional field of the wrong shape is dropped, so an
 * older or newer server never costs the answer its number marks.
 */
export function readVerification(data: unknown): AskVerification | null {
  if (!isRecord(data) || typeof data.checked !== "boolean" || !isStringList(data.unsupported)) {
    return null;
  }
  const verification: AskVerification = { unsupported: data.unsupported, checked: data.checked };
  if (isStringList(data.userStated)) verification.userStated = data.userStated;
  if (isStringList(data.unverifiedLinks)) verification.unverifiedLinks = data.unverifiedLinks;
  if (Array.isArray(data.issues)) {
    verification.issues = data.issues.flatMap(
      (issue): { figure: string; kind: FigureIssueKind }[] =>
        isRecord(issue) &&
        typeof issue.figure === "string" &&
        typeof issue.kind === "string" &&
        ISSUE_KINDS.includes(issue.kind)
          ? [{ figure: issue.figure, kind: issue.kind as FigureIssueKind }]
          : [],
    );
  }
  const evidence = data.evidence;
  if (
    isRecord(evidence) &&
    typeof evidence.sources === "number" &&
    isStringList(evidence.failed) &&
    typeof evidence.truncated === "boolean" &&
    isStringList(evidence.warnings)
  ) {
    verification.evidence = {
      sources: evidence.sources,
      failed: evidence.failed,
      truncated: evidence.truncated,
      warnings: evidence.warnings,
    };
  }
  return verification;
}

const list = (items: readonly string[]) => [...new Set(items)].join("、");

/**
 * The footnotes under an answer, in reading order. An empty issue list never says the answer was
 * verified: the last line states what the check did and did not cover.
 */
export function verificationNotes(verification: AskVerification): string[] {
  if (!verification.checked) return [ASK_COPY.chat.unchecked];
  const notes: string[] = [];
  const byKind = new Map<FigureIssueKind, string[]>();
  for (const { figure, kind } of verification.issues ?? []) {
    byKind.set(kind, [...(byKind.get(kind) ?? []), figure]);
  }
  // A server that sent only `unsupported` (no issue kinds) still gets its numbers worded.
  if ((verification.issues ?? []).length === 0 && verification.unsupported.length > 0) {
    byKind.set("unsupported", verification.unsupported);
  }
  for (const [kind, figures] of byKind) notes.push(ASK_COPY.chat.issue[kind](list(figures)));
  if (verification.userStated && verification.userStated.length > 0) {
    notes.push(ASK_COPY.chat.userStated(list(verification.userStated)));
  }
  if (verification.unverifiedLinks && verification.unverifiedLinks.length > 0) {
    notes.push(ASK_COPY.chat.unverifiedLinks(list(verification.unverifiedLinks)));
  }
  const evidence = verification.evidence;
  if (evidence) {
    if (evidence.failed.length > 0) notes.push(ASK_COPY.chat.noData(list(evidence.failed)));
    if (evidence.truncated) notes.push(ASK_COPY.chat.truncated);
    if (evidence.warnings.includes("stale")) notes.push(ASK_COPY.chat.stale);
    if (evidence.warnings.includes("provisional")) notes.push(ASK_COPY.chat.provisional);
    if (evidence.warnings.includes("mixed_session")) notes.push(ASK_COPY.chat.mixedSession);
    notes.push(evidence.sources === 0 ? ASK_COPY.chat.noEvidence : ASK_COPY.chat.checkScope);
  }
  return notes;
}
