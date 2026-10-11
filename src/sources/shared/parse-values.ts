const EMPTY_MARKERS = new Set(["", "—", "-", "無成交"]);
const NUMBER_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

/** Parses a signed/comma/percent text cell. Returns null for empty markers; throws on garbage. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (EMPTY_MARKERS.has(trimmed)) return null;
  const cleaned = trimmed.replace(/−/g, "-").replace(/[,%+]/g, "");
  if (!NUMBER_PATTERN.test(cleaned)) {
    throw new Error(`Cannot parse number from "${text}"`);
  }
  return Number(cleaned);
}

/** Like parseNumber, but empty markers count as 0 (limit-up/down lock counts). */
export function parseCount(text: string): number {
  return parseNumber(text) ?? 0;
}

function parseSlashSeparated(text: string, length: number): number[] {
  const parts = text.split("/").map((part) => parseNumber(part));
  if (parts.length !== length || parts.some((part) => part === null)) {
    throw new Error(`Expected ${length} slash-separated numbers, got "${text}"`);
  }
  return parts as number[];
}

export function parseTriple(text: string): [number, number, number] {
  const [a, b, c] = parseSlashSeparated(text, 3);
  return [a as number, b as number, c as number];
}

export function parsePair(text: string): [number, number] {
  const [a, b] = parseSlashSeparated(text, 2);
  return [a as number, b as number];
}

/** "115/09/01" or "1150101" (ROC calendar) to ISO "2026-09-01". */
export function parseRocDate(text: string): string {
  const trimmed = text.trim();
  const match =
    /^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/.exec(trimmed) ?? /^(\d{3})(\d{2})(\d{2})$/.exec(trimmed);
  if (!match) throw new Error(`Cannot parse ROC date from "${text}"`);
  const [, rocYear, month, day] = match;
  const year = Number(rocYear) + 1911;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "安碁 6174" to { name: "安碁", code: "6174" }. */
export function parseStockLabel(text: string): { name: string; code: string } {
  const match = /^(.+?)\s+([0-9A-Z]{4,6})$/.exec(text.trim());
  if (!match) throw new Error(`Cannot parse stock label from "${text}"`);
  return { name: match[1] as string, code: match[2] as string };
}

/** "染料，顏料 +4.3、不織布 +3.5" to [{ name, changePct }, ...]. */
export function parseMovers(text: string): { name: string; changePct: number }[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  return trimmed.split("、").map((entry) => {
    const match = /^(.+?)\s*([+\-−]?\d+(?:\.\d+)?)$/.exec(entry.trim());
    const changePct = match ? parseNumber(match[2] as string) : null;
    if (!match || changePct === null) throw new Error(`Cannot parse mover from "${entry}"`);
    return { name: (match[1] as string).trim(), changePct };
  });
}
