// Test helper: a finished assistant turn with every field set, so a test states only what it
// changes.
import type { EvidenceRecord } from "@/ask/evidence";
import type { Turn } from "./use-ask-chat";

export const makeTurn = (patch: Partial<Turn> = {}): Turn => ({
  id: "t1",
  role: "assistant",
  text: "**結論**\n偏多。",
  notices: [],
  verification: null,
  tools: [],
  streaming: false,
  failed: false,
  stopped: false,
  timedOut: false,
  finishReason: null,
  startedAt: null,
  lens: null,
  context: null,
  ...patch,
});

export const makeRecord = (patch: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  id: "s1",
  tool: "getMarketToday",
  kind: "internal",
  retrievedAt: "2026-10-24T08:00:00.000Z",
  dataDate: "2026-10-24",
  asOf: null,
  session: "closed",
  urls: [],
  truncated: false,
  failed: false,
  warnings: [],
  ...patch,
});

/** A verification whose evidence lists these records (sources = those that returned data). */
export const makeVerification = (
  records: EvidenceRecord[],
  patch: {
    unsupported?: string[];
    truncated?: boolean;
    warnings?: string[];
    omitted?: number;
  } = {},
) => ({
  unsupported: patch.unsupported ?? [],
  checked: true,
  evidence: {
    sources: records.filter((r) => !r.failed).length,
    failed: [...new Set(records.filter((r) => r.failed).map((r) => r.tool))],
    truncated: patch.truncated ?? records.some((r) => r.truncated),
    warnings: patch.warnings ?? [...new Set(records.flatMap((r) => r.warnings))],
    records,
    omitted: patch.omitted ?? 0,
  },
});
