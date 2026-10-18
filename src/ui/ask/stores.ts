// What the Ask screen keeps on this device (localStorage only; the server never stores it).
// Reads are tolerant per entry and per field: whatever is wrong with one stored value never costs
// the rest, and nothing here throws. Writes report failure as `false` and never break the UI.
import { ASK_LIMITS } from "@/ui/ask/limits";
import { keysWithPrefix, readItem, removeItem, writeItem } from "@/ui/device/storage";
import { MAX_AMOUNT } from "@/ui/plan/draft";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type Holding = { symbol: string; amount?: number; quantity?: number };

const KEY_PREFIX = "muggle.ask.";
export const CHAT_KEY = `${KEY_PREFIX}chat.v1`;
export const HOLDINGS_KEY = `${KEY_PREFIX}holdings.v1`;
export const MEMORY_KEY = `${KEY_PREFIX}memory.v1`;
export const PROFILE_KEY = `${KEY_PREFIX}profile.v1`;
export const ACK_KEY = `${KEY_PREFIX}ack.v1`;

/** Mirrors the server's holding symbol rule (`src/ask/schema.ts`). */
const SYMBOL = /^[0-9A-Za-z]{2,10}$/;

/** Far above anything the limits allow to be stored; a bigger value is corruption, not data. */
const MAX_RAW_CHARS = 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored array, or [] for nothing, oversize text, invalid JSON or any other shape. */
function parseArray(raw: string | null): unknown[] {
  if (raw === null || raw.length > MAX_RAW_CHARS) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Cuts to `max` UTF-16 units (what the server counts) without leaving half a surrogate pair. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

const isMessageRole = (role: unknown): role is ChatMessage["role"] =>
  role === "user" || role === "assistant";

function sanitizeChat(entries: unknown[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const { role, content } = entry;
    if (!isMessageRole(role) || typeof content !== "string" || content === "") continue;
    messages.push({ role, content: truncate(content, ASK_LIMITS.maxMessageChars) });
  }
  return messages.slice(-ASK_LIMITS.maxMessages);
}

export function parseChat(raw: string | null): ChatMessage[] {
  return sanitizeChat(parseArray(raw));
}

const validAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_AMOUNT;

function sanitizeHoldings(entries: unknown[]): Holding[] {
  const holdings: Holding[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const { symbol, amount, quantity } = entry;
    if (typeof symbol !== "string" || !SYMBOL.test(symbol)) continue;
    const holding: Holding = { symbol };
    if (validAmount(amount)) holding.amount = amount;
    if (validAmount(quantity)) holding.quantity = quantity;
    holdings.push(holding);
  }
  return holdings.slice(0, ASK_LIMITS.maxHoldings);
}

export function parseHoldings(raw: string | null): Holding[] {
  return sanitizeHoldings(parseArray(raw));
}

/** One line, single spaces, at most 200 characters; "" when nothing is left. */
function normalizeNote(note: string): string {
  const oneLine = note.replace(/\s+/g, " ").trim();
  return truncate(oneLine, ASK_LIMITS.maxMemoryChars).trim();
}

function sanitizeMemory(entries: unknown[]): string[] {
  const notes: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const note = normalizeNote(entry);
    if (note !== "" && !notes.includes(note)) notes.push(note);
    if (notes.length === ASK_LIMITS.maxMemoryNotes) break;
  }
  return notes;
}

export function parseMemory(raw: string | null): string[] {
  return sanitizeMemory(parseArray(raw));
}

/**
 * `notes` plus the cleaned-up `note`. The same list comes back when there is nothing to add: the
 * note is empty, already saved, or the list already holds the maximum.
 */
export function addMemoryNote(notes: string[], note: string): string[] {
  const clean = normalizeNote(note);
  if (clean === "" || notes.includes(clean)) return notes;
  if (notes.length >= ASK_LIMITS.maxMemoryNotes) return notes;
  return [...notes, clean];
}

export const readChat = (): ChatMessage[] => parseChat(readItem(CHAT_KEY));
export const writeChat = (messages: readonly ChatMessage[]): boolean =>
  writeItem(CHAT_KEY, JSON.stringify(sanitizeChat([...messages])));
export const clearChat = (): boolean => removeItem(CHAT_KEY);

export const readHoldings = (): Holding[] => parseHoldings(readItem(HOLDINGS_KEY));
export const writeHoldings = (holdings: readonly Holding[]): boolean =>
  writeItem(HOLDINGS_KEY, JSON.stringify(sanitizeHoldings([...holdings])));
export const clearHoldings = (): boolean => removeItem(HOLDINGS_KEY);

export const readMemory = (): string[] => parseMemory(readItem(MEMORY_KEY));
export const writeMemory = (notes: readonly string[]): boolean =>
  writeItem(MEMORY_KEY, JSON.stringify(sanitizeMemory([...notes])));
export const clearMemory = (): boolean => removeItem(MEMORY_KEY);

/** A stored `{ [field]: true }` flag; anything else (missing, corrupt, not exactly true) is off. */
function readFlag(key: string, field: string): boolean {
  const raw = readItem(key);
  if (raw === null || raw.length > MAX_RAW_CHARS) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && parsed[field] === true;
  } catch {
    return false;
  }
}

/** Whether the person chose to send their saved plan answers with questions. Off by default. */
export const readPlanOptIn = (): boolean => readFlag(PROFILE_KEY, "plan");
export const writePlanOptIn = (on: boolean): boolean =>
  writeItem(PROFILE_KEY, JSON.stringify({ plan: on }));

/** Whether the first-use disclosure was acknowledged on this device. */
export const readAck = (): boolean => readFlag(ACK_KEY, "ack");
export const writeAck = (): boolean => writeItem(ACK_KEY, JSON.stringify({ ack: true }));

/** Forgets everything the Ask screen keeps, including keys of other versions. */
export function clearAllAskData(): void {
  for (const key of keysWithPrefix(KEY_PREFIX)) removeItem(key);
}
