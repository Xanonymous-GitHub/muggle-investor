import type { MarketPhase } from "@/market-clock/market-clock";

const NO_STORE = "no-store";
const SETTLED_CACHE = "public, s-maxage=300, stale-while-revalidate=600";

/** Data still moving (intraday) or being finalised (settling) must not be cached by shared caches. */
export const cacheControlFor = (phase: MarketPhase): string =>
  phase === "intraday" || phase === "settling" ? NO_STORE : SETTLED_CACHE;

export type DataDate = { tradeDate: string; asOf: string | null };

/** JSON response labelled with the date of the data it carries, so clients can always show it. */
export function marketJson(body: unknown, phase: MarketPhase, dated: DataDate | null): Response {
  const headers = new Headers({ "cache-control": cacheControlFor(phase) });
  if (dated) {
    headers.set("x-data-trade-date", dated.tradeDate);
    if (dated.asOf) headers.set("x-data-as-of", dated.asOf);
  }
  return Response.json(body, { headers });
}

export const errorJson = (
  error: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response =>
  Response.json({ error }, { status, headers: { ...extraHeaders, "cache-control": NO_STORE } });
