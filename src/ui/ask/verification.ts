// Reads the `data-verification` part of the answer stream and words what it says. Pure: the
// stream consumer and the answer view import these; the rules are pinned by verification.test.ts.
import type { AskNotice, AskVerification, FigureIssueKind } from "@/ask/ask-message";
import type { EvidenceRecord } from "@/ask/evidence";
import { toolLabel } from "@/ui/ask/answer";
import { ASK_COPY } from "@/ui/ask/copy";

const NOTICE_KINDS: readonly string[] = [
  "no_web",
  "no_tools",
  "tool_failed",
  "timeout",
  "limited",
  "trimmed",
  "declined",
  "withheld",
];

/** A `data-notice` part, or null when it is not one this screen knows. */
export function readNotice(data: unknown): AskNotice | null {
  if (!isRecord(data) || typeof data.text !== "string") return null;
  if (typeof data.kind !== "string" || !NOTICE_KINDS.includes(data.kind)) return null;
  return { kind: data.kind, text: data.text } as AskNotice;
}

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
  if (typeof data.rememberSupported === "boolean") {
    verification.rememberSupported = data.rememberSupported;
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
    // Records are optional and dropped one by one: a server that sends none (or a malformed one)
    // still gets its counts and footnotes.
    if (Array.isArray(evidence.records)) {
      verification.evidence.records = evidence.records.flatMap((record): EvidenceRecord[] => {
        const read = readRecord(record);
        return read === null ? [] : [read];
      });
      verification.evidence.omitted =
        typeof evidence.omitted === "number" && evidence.omitted > 0
          ? Math.floor(evidence.omitted)
          : 0;
    }
  }
  return verification;
}

const nullableString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** One source record, or null when its required parts are missing or of the wrong type. */
function readRecord(value: unknown): EvidenceRecord | null {
  if (!isRecord(value)) return null;
  const { id, tool, kind, retrievedAt, urls, truncated, failed, warnings } = value;
  if (typeof id !== "string" || typeof tool !== "string" || typeof retrievedAt !== "string") {
    return null;
  }
  if (kind !== "internal" && kind !== "external") return null;
  if (typeof truncated !== "boolean" || typeof failed !== "boolean") return null;
  if (!isStringList(urls) || !isStringList(warnings)) return null;
  return {
    id,
    tool,
    kind,
    retrievedAt,
    dataDate: nullableString(value.dataDate),
    asOf: nullableString(value.asOf),
    session: nullableString(value.session),
    urls,
    truncated,
    failed,
    warnings,
  };
}

const list = (items: readonly string[]) => [...new Set(items)].join("、");

/**
 * What the number check found wrong with the answer, in reading order: figures that no source
 * carries (or carries differently), figures only the user stated, links the run never saw, and a
 * check that could not run. These stay in plain view under the answer.
 */
export function verificationWarnings(verification: AskVerification): string[] {
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
  return notes;
}

/**
 * What the run's tools did and did not return, ending with what the check covers. The last line
 * always states that an empty issue list does not mean the answer was verified.
 */
export function evidenceNotes(verification: AskVerification): string[] {
  const evidence = verification.evidence;
  if (!verification.checked || !evidence) return [];
  const notes: string[] = [];
  if (evidence.failed.length > 0)
    notes.push(ASK_COPY.chat.noData(list(evidence.failed.map(toolLabel))));
  if (evidence.truncated) notes.push(ASK_COPY.chat.truncated);
  if (evidence.warnings.includes("stale")) notes.push(ASK_COPY.chat.stale);
  if (evidence.warnings.includes("provisional")) notes.push(ASK_COPY.chat.provisional);
  if (evidence.warnings.includes("mixed_session")) notes.push(ASK_COPY.chat.mixedSession);
  notes.push(evidence.sources === 0 ? ASK_COPY.chat.noEvidence : ASK_COPY.chat.checkScope);
  return notes;
}

/** Every footnote under an answer, in reading order: the warnings, then the evidence notes. */
export const verificationNotes = (verification: AskVerification): string[] => [
  ...verificationWarnings(verification),
  ...evidenceNotes(verification),
];
