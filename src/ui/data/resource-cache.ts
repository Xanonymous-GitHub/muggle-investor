// Last good response per url, so a screen can show something at once and offline.
import { keysWithPrefix, readItem, removeItem, writeItem } from "@/ui/device/storage";

export const CACHE_VERSION = 1;
export const MAX_CACHE_ENTRIES = 30;
/** Serialized length above which a response is not cached (localStorage quotas are ~5 MB). */
const MAX_ENTRY_LENGTH = 1_000_000;
const PREFIX = "muggle.cache.";

export type CacheEntry<T> = { v: number; savedAt: string; dataDate: string | null; body: T };

const keyOf = (url: string): string => `${PREFIX}${url}`;

function parse<T>(raw: string | null): CacheEntry<T> | null {
  if (raw === null) return null;
  try {
    const e: unknown = JSON.parse(raw);
    if (typeof e !== "object" || e === null || !("body" in e)) return null;
    const { v, savedAt, dataDate } = e as Partial<CacheEntry<unknown>>;
    if (v !== CACHE_VERSION || typeof savedAt !== "string") return null;
    if (dataDate !== null && typeof dataDate !== "string") return null;
    return e as CacheEntry<T>;
  } catch {
    return null;
  }
}

export function readCache<T>(url: string): CacheEntry<T> | null {
  return parse<T>(readItem(keyOf(url)));
}

/**
 * Stores `entry` for `url`, evicting the oldest entries so at most `MAX_CACHE_ENTRIES` remain.
 * Unreadable entries, and ones stamped later than `now` (the device clock moved back), count
 * as oldest. Oversize bodies are skipped; storage failures are silent.
 */
export function writeCache<T>(url: string, entry: CacheEntry<T>, now: Date = new Date()): void {
  const serialized = JSON.stringify(entry);
  if (serialized.length > MAX_ENTRY_LENGTH) return;
  const key = keyOf(url);
  const others = keysWithPrefix(PREFIX).filter((k) => k !== key);
  const excess = others.length + 1 - MAX_CACHE_ENTRIES;
  if (excess > 0) {
    const nowMs = now.getTime();
    const age = (k: string): number => {
      const savedAt = Date.parse(parse(readItem(k))?.savedAt ?? "");
      return Number.isNaN(savedAt) || savedAt > nowMs ? Number.NEGATIVE_INFINITY : savedAt;
    };
    const oldestFirst = others.map((k) => ({ k, at: age(k) })).sort((a, b) => a.at - b.at);
    for (const { k } of oldestFirst.slice(0, excess)) removeItem(k);
  }
  writeItem(key, serialized);
}
