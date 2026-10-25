// What the Ask screen keeps on this device (localStorage only; the server never stores it).
// Reads are tolerant per entry and per field: whatever is wrong with one stored value never costs
// the rest, and nothing here throws. Writes report failure as `false` and never break the UI.
import { ASK_LIMITS } from "@/ui/ask/limits";
import {
  type MemoryNote,
  markReviewed,
  mergeWithMirror,
  parseStored,
  reconcileNotes,
  rememberOffer,
  sanitizeNotes,
  serializeNotes,
  textsOf,
} from "@/ui/ask/memory-notes";
import { keysWithPrefix, readItem, removeItem, writeItem } from "@/ui/device/storage";
import { MAX_AMOUNT } from "@/ui/plan/draft";

/** `partial: true` marks an answer the person stopped, so it stays "stopped" after a reload. */
export type ChatMessage = { role: "user" | "assistant"; content: string; partial?: true };
export type Holding = { symbol: string; amount?: number; quantity?: number };

const KEY_PREFIX = "muggle.ask.";
export const CHAT_KEY = `${KEY_PREFIX}chat.v1`;
export const HOLDINGS_KEY = `${KEY_PREFIX}holdings.v1`;
/** The note texts alone: still written (as a mirror) so an older version keeps working. */
export const MEMORY_KEY = `${KEY_PREFIX}memory.v1`;
/** The notes with origin, dates and what each replaced. */
export const MEMORY_V2_KEY = `${KEY_PREFIX}memory.v2`;
export const PROFILE_KEY = `${KEY_PREFIX}profile.v1`;
export const ACK_KEY = `${KEY_PREFIX}ack.v1`;

/** Mirrors the server's holding symbol rule (`src/ask/schema.ts`). */
const SYMBOL = /^[0-9A-Za-z]{2,10}$/;

/** Whether `symbol` is one the server accepts for a holding. */
export const isHoldingSymbol = (symbol: string): boolean => SYMBOL.test(symbol);

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
    const message: ChatMessage = { role, content: truncate(content, ASK_LIMITS.maxMessageChars) };
    // Only a literal `true` counts; anything else is an ordinary message.
    if (entry.partial === true) message.partial = true;
    messages.push(message);
  }
  // What is shown may open with an answer; the request is cut again (and opens with a question)
  // by `trimMessages`.
  return messages.slice(-ASK_LIMITS.maxMessages);
}

export function parseChat(raw: string | null): ChatMessage[] {
  return sanitizeChat(parseArray(raw));
}

const validAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_AMOUNT;

/** The storable holdings: valid symbols, valid optional whole numbers, at most the maximum. */
export function sanitizeHoldings(entries: unknown[]): Holding[] {
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

/** Single spaces, no line breaks, no spaces at the ends; not yet cut to size. */
const oneLine = (note: string): string => note.replace(/\s+/g, " ").trim();

/** One line, single spaces, at most 200 characters; "" when nothing is left. */
export function normalizeNote(note: string): string {
  return truncate(oneLine(note), ASK_LIMITS.maxMemoryChars).trim();
}

/** True when the note, as one cleaned-up line, is longer than a saved note may be. */
export function isNoteTooLong(note: string): boolean {
  return oneLine(note).length > ASK_LIMITS.maxMemoryChars;
}

/** The storable notes: one line each, no empties or repeats, cut to size, at most the maximum. */
export function sanitizeMemory(entries: unknown[]): string[] {
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

/**
 * The notes with their records. `memory.v1` (the texts) decides WHICH notes exist, because a
 * version that only knows it may have added or deleted notes since `memory.v2` was written, and a
 * deleted note must stay deleted; `memory.v2` supplies the records. Notes only in `memory.v1`
 * (saved by an older version) come back with origin `unknown`. Nothing here throws.
 */
export function readMemoryNotes(): MemoryNote[] {
  return mergeWithMirror(parseStored(readItem(MEMORY_V2_KEY)), parseMemory(readItem(MEMORY_KEY)));
}

/**
 * Stores the notes: the texts first (they are the authority), then the records. A failed text
 * write reports false and writes nothing else; a failed record write costs only the metadata,
 * which the next read rebuilds from the texts.
 */
export function writeMemoryNotes(notes: readonly MemoryNote[]): boolean {
  const clean = sanitizeNotes([...notes]);
  if (!writeItem(MEMORY_KEY, JSON.stringify(textsOf(clean)))) return false;
  writeItem(MEMORY_V2_KEY, serializeNotes(clean));
  return true;
}

/** The texts the server receives with a question. */
export const readMemory = (): string[] => textsOf(readMemoryNotes());

/** The person's list of texts after an edit, deletion or addition; each note keeps its record. */
export const writeMemory = (texts: readonly string[], now: Date = new Date()): boolean =>
  writeMemoryNotes(reconcileNotes(readMemoryNotes(), texts, now));

export const clearMemory = (): boolean => {
  const v1 = removeItem(MEMORY_KEY);
  const v2 = removeItem(MEMORY_V2_KEY);
  return v1 && v2;
};

/** What happened to an offer the person accepted. */
export type RememberOutcome = "saved" | "full" | "failed";

/** The only way an offered note is saved: a note on the same topic is replaced, and says so. */
export function rememberFact(fact: string, now: Date = new Date()): RememberOutcome {
  const result = rememberOffer(readMemoryNotes(), fact, now);
  if (result.kind === "same") return "saved";
  if (result.kind === "empty") return "failed";
  if (result.kind === "full") return "full";
  return writeMemoryNotes(result.notes) ? "saved" : "failed";
}

/** The person says a note still holds: its review clock restarts. */
export function reviewMemoryNote(text: string, now: Date = new Date()): boolean {
  return writeMemoryNotes(markReviewed(readMemoryNotes(), text, now));
}

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
