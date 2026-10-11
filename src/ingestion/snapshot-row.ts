import type { NewSnapshot, SnapshotKind } from "@/db/repositories/snapshots";
import { toTaipei } from "@/market-clock/market-clock";
import type { Fetched } from "@/sources/darkfanxing";

/** Bumped whenever a darkfanxing parser changes the shape stored in `parsed`. */
export const PARSER_VERSION = 1;

/** What a report says about its own date; `session` is absent for reports that do not carry one. */
type Dated = { tradeDate: string; asOf: string | null; session?: NewSnapshot["session"] };

/**
 * Builds the row for one upstream response. The trade date comes from the document (parsed, else
 * the title metadata), falling back to the capture date only when neither could be read.
 * `scrub` must remove the upstream key: the raw body and the parse error are stored.
 */
export function snapshotRow<T extends Dated>(
  kind: SnapshotKind,
  groupName: string | null,
  fetched: Fetched<T>,
  scrub: (text: string) => string,
): NewSnapshot {
  const dated: Dated | null = fetched.parsed ?? fetched.meta;
  return {
    kind,
    groupName,
    tradeDate: dated?.tradeDate ?? toTaipei(fetched.fetchedAt).date,
    asOf: dated?.asOf ?? null,
    session: dated?.session ?? "unknown",
    capturedAt: fetched.fetchedAt,
    rawHtml: scrub(fetched.raw),
    parsed: fetched.parsed,
    parseError: fetched.parseError === null ? null : scrub(fetched.parseError),
    parserVersion: PARSER_VERSION,
  };
}
