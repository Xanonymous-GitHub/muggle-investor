import { isCalendarDate } from "@/lib/dates";
import { readItem, writeItem } from "@/ui/device/storage";

export const LAST_SEEN_KEY = "muggle.lastSeen.v1";

export function readLastSeen(): string | null {
  const raw = readItem(LAST_SEEN_KEY);
  return raw !== null && isCalendarDate(raw) ? raw : null;
}

/** Remembers the newest trade date seen; an older date never replaces a newer one. */
export function writeLastSeen(tradeDate: string): void {
  if (!isCalendarDate(tradeDate)) return;
  const stored = readLastSeen();
  if (stored !== null && tradeDate < stored) return;
  writeItem(LAST_SEEN_KEY, tradeDate);
}
