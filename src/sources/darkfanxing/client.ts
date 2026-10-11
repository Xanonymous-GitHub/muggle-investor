import { fetchWithRetry } from "@/lib/http";
import { createRateLimiter, type RateLimiter, type Sleep } from "@/lib/rate-limiter";
import { parseDigest } from "./parse-digest";
import { parseSectorBoard } from "./parse-sector-board";
import { parseSectorDetail } from "./parse-sector-detail";
import { parseTitle } from "./parse-title";
import { parseReportDocument } from "./report-document";
import type { DigestSnapshot, SectorBoard, SectorDetail, TitleMeta } from "./schemas";

/**
 * One upstream response. HTTP failures throw; parse failures do not, so the raw body is
 * never lost: `parsed` is null and `parseError` explains why.
 */
export type Fetched<T> = {
  raw: string;
  parsed: T | null;
  parseError: string | null;
  /** Title metadata read from the <h1> independently of the full parse, so a snapshot can still be dated when `parsed` is null. */
  meta: TitleMeta | null;
  fetchedAt: Date;
};

export interface DarkfanxingClient {
  fetchDigest(): Promise<Fetched<DigestSnapshot>>;
  fetchSectorBoard(): Promise<Fetched<SectorBoard>>;
  fetchSectorDetail(group: string): Promise<Fetched<SectorDetail>>;
}

export type DarkfanxingClientOptions = {
  baseUrl: string;
  /** Upstream secret; it is part of the URL path and must never be logged or stored. */
  key: string;
  limiter: RateLimiter;
  fetchImpl?: typeof fetch;
  /** Backoff sleep between retries; injectable for tests. */
  sleep?: Sleep;
};

/**
 * Measured upstream limit: 10 requests per fixed 60 s window.
 * Create ONE limiter per process and share it between every client and caller
 * (ingestion job, on-demand sector detail); separate instances would each grant
 * the full quota and together exceed the upstream limit.
 */
export const createDarkfanxingLimiter = (): RateLimiter =>
  createRateLimiter({ capacity: 10, refillEveryMs: 60_000 });

/** Retries consume upstream quota, so keep them few. */
const RETRIES = 2;

/** Replaces the key, raw and URL-encoded, with `placeholder` (e.g. before persisting an upstream body). */
export const redactKey = (text: string, key: string, placeholder: string): string =>
  [key, encodeURIComponent(key)].reduce(
    (out, secret) => (secret === "" ? out : out.split(secret).join(placeholder)),
    text,
  );

const readMeta = (html: string): TitleMeta | null => {
  try {
    return parseTitle(parseReportDocument(html).title);
  } catch {
    return null;
  }
};

export function createDarkfanxingClient({
  baseUrl,
  key,
  limiter,
  fetchImpl,
  sleep,
}: DarkfanxingClientOptions): DarkfanxingClient {
  const redact = (url: string) => redactKey(url, key, "***");

  const fetchReport = async <T>(url: string, parse: (html: string) => T): Promise<Fetched<T>> => {
    await limiter.acquire();
    const response = await fetchWithRetry(url, {
      retries: RETRIES,
      redact,
      ...(fetchImpl && { fetchImpl }),
      ...(sleep && { sleep }),
    });
    const raw = await response.text();
    const fetchedAt = new Date();
    const meta = readMeta(raw);
    try {
      return { raw, parsed: parse(raw), parseError: null, meta, fetchedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { raw, parsed: null, parseError: redactKey(message, key, "***"), meta, fetchedAt };
    }
  };

  const keyPath = encodeURIComponent(key);
  return {
    fetchDigest: () => fetchReport(`${baseUrl}/api/digest/${keyPath}`, parseDigest),
    fetchSectorBoard: () => fetchReport(`${baseUrl}/api/now/${keyPath}`, parseSectorBoard),
    fetchSectorDetail: (group) =>
      fetchReport(
        `${baseUrl}/api/now/${keyPath}?group=${encodeURIComponent(group)}`,
        parseSectorDetail,
      ),
  };
}
