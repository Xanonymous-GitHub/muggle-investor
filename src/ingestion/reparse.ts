import type { Logger } from "pino";
import type { Db } from "@/db/client";
import {
  listReparseCandidates,
  markReparseAttempted,
  type Snapshot,
  updateSnapshotParse,
} from "@/db/repositories/snapshots";
import { parseDigest, parseSectorBoard, parseSectorDetail } from "@/sources/darkfanxing";
import { PARSER_VERSION } from "./snapshot-row";

export type ReparseResult = {
  scanned: number;
  fixed: number;
  stillFailing: number;
  /** Parsed fine, but the report's own date/session already belongs to another stored row. */
  conflicts: number;
};

type Dated = { tradeDate: string; asOf: string | null; session?: Snapshot["session"] };

const DEFAULT_LIMIT = 20;

const PARSERS: Record<Snapshot["kind"], (html: string) => Dated> = {
  digest: parseDigest,
  sector_board: parseSectorBoard,
  sector_detail: parseSectorDetail,
};

/**
 * Re-parses stored raw HTML of snapshots that never parsed or were parsed by an older parser, in
 * place. The stored raw is already key-scrubbed and is never written here. A failed parse or a
 * key conflict only marks the row as attempted at this parser version (plus the error message for
 * a failed parse); the previous `parsed`, dates and `parserVersion` stay, so nothing is ever lost,
 * and `parse_error` may coexist with a valid `parsed` for an outdated row. The row is not a
 * candidate again until the parser version rises. A successful parse re-dates the row from the report, like `snapshotRow`.
 */
export async function reparseSnapshots(
  { db, logger }: { db: Db; logger: Logger },
  opts: { limit?: number; currentParserVersion?: number } = {},
): Promise<ReparseResult> {
  const parserVersion = opts.currentParserVersion ?? PARSER_VERSION;
  const candidates = await listReparseCandidates(db, {
    currentParserVersion: parserVersion,
    limit: opts.limit ?? DEFAULT_LIMIT,
  });
  const result: ReparseResult = {
    scanned: candidates.length,
    fixed: 0,
    stillFailing: 0,
    conflicts: 0,
  };
  for (const row of candidates) {
    const outcome = await reparseOne(db, row, parserVersion);
    if (outcome.status === "fixed") {
      result.fixed++;
    } else if (outcome.status === "conflict") {
      result.conflicts++;
      logger.warn(
        { id: row.id, kind: row.kind, tradeDate: outcome.tradeDate, session: outcome.session },
        "re-parse collides with a stored snapshot; row left unchanged",
      );
    } else {
      result.stillFailing++;
      logger.warn(
        { id: row.id, kind: row.kind, tradeDate: row.tradeDate, parseError: outcome.parseError },
        "re-parse still failing",
      );
    }
  }
  return result;
}

type Outcome =
  | { status: "fixed" }
  | { status: "conflict"; tradeDate: string; session: Snapshot["session"] }
  | { status: "failing"; parseError: string };

async function reparseOne(db: Db, row: Snapshot, parserVersion: number): Promise<Outcome> {
  let parsed: Dated;
  try {
    parsed = PARSERS[row.kind](row.rawHtml);
  } catch (error) {
    // `.message` only: the raw document must never be copied into parse_error.
    const parseError = error instanceof Error ? error.message : String(error);
    await markReparseAttempted(db, row.id, parserVersion, parseError);
    return { status: "failing", parseError };
  }
  const patch = {
    tradeDate: parsed.tradeDate,
    asOf: parsed.asOf,
    session: parsed.session ?? "unknown",
    parsed,
    parseError: null,
    parserVersion,
  };
  const { updated } = await updateSnapshotParse(db, row.id, patch);
  if (updated) return { status: "fixed" };
  await markReparseAttempted(db, row.id, parserVersion);
  return { status: "conflict", tradeDate: patch.tradeDate, session: patch.session };
}
