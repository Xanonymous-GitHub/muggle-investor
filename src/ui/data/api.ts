// Response shapes of the public JSON routes and the urls that serve them. Server types are
// imported with `import type` only, so no server code reaches the client bundle.
import type { GlossaryTerm } from "@/glossary";
import type { BriefingResponse } from "@/insight/briefing-service";
import type { Lens } from "@/insight/lens";
import type { Recap } from "@/recap/recap-service";
import type { DigestSnapshot, SectorBoard, SectorDetail } from "@/sources/darkfanxing/schemas";

/** What `T` looks like after a JSON round trip: dates arrive as ISO strings. */
export type Jsonify<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export type TodayResponse = {
  digest: DigestSnapshot | null;
  board: SectorBoard | null;
  stale: boolean;
};
export type BriefingJson = Jsonify<BriefingResponse>;
export type RecapJson = Jsonify<Recap>;
export type SectorDetailJson = SectorDetail;
export type GlossaryJson = { terms: GlossaryTerm[] };

export const todayUrl = (): string => "/api/market/today";
export const briefingLatestUrl = (lens: Lens): string => `/api/briefings/latest?lens=${lens}`;
export const recapUrl = (since: string): string =>
  `/api/market/recap?since=${encodeURIComponent(since)}`;
export const sectorsUrl = (): string => "/api/market/sectors";
export const sectorDetailUrl = (group: string): string =>
  `/api/market/sectors/${encodeURIComponent(group)}`;
export const glossaryUrl = (): string => "/api/glossary";
