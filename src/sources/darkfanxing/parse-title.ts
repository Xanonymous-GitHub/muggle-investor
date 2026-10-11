import { DarkfanxingParseError, type TitleMeta, titleMetaSchema, validate } from "./schemas";

/** Reads trade date, as-of time and session from a report title (or raw <h1>). */
export function parseTitle(title: string): TitleMeta {
  const match = /(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/.exec(title);
  if (!match) {
    throw new DarkfanxingParseError(`no ISO date in title "${title}"`, { section: "title" });
  }
  const session = title.includes("收盤後")
    ? "closed"
    : title.includes("盤中")
      ? "intraday"
      : "unknown";
  return validate(
    titleMetaSchema,
    { tradeDate: match[1], asOf: match[2] ?? null, session },
    "title",
  );
}
