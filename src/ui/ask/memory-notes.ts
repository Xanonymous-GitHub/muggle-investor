// The remembered notes with what is known about each: where it came from, when it was written and
// last changed, when to look at it again, and what it replaced. Pure: no storage, no clock (callers
// pass `now`), no throwing. The device keeps this as `memory.v2`; the server still receives only the
// note texts (`profile.memory: string[]`), so none of this metadata leaves the device.
import { ASK_LIMITS } from "@/ui/ask/limits";

/**
 * `offer_accepted`: the person pressed 記住 on an offer in an answer. `manual`: typed in the data
 * sheet. `unknown`: saved by a version that kept no record (everything migrated from `memory.v1`).
 */
export type MemoryOrigin = "offer_accepted" | "manual" | "unknown";

export type MemoryNote = {
  text: string;
  origin: MemoryOrigin;
  /** `YYYY-MM-DD`; null for a note migrated from `memory.v1`. */
  createdAt: string | null;
  updatedAt: string | null;
  /** The day to ask "is this still true?"; null when never set (migrated notes). */
  reviewAfter: string | null;
  /** Older notes this one replaced when the person accepted it, newest first. Shown, never sent. */
  replaced: string[];
};

/** A note not looked at for this long is offered for review. */
export const REVIEW_AFTER_DAYS = 180;
const MAX_REPLACED = 3;
/** The share of the shorter note's character pairs that the other repeats for them to be "about the same". */
const SAME_TOPIC_OVERLAP = 0.6;
const MIN_SAME_TOPIC_PAIRS = 4;

const ORIGINS: readonly MemoryOrigin[] = ["offer_accepted", "manual", "unknown"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Single spaces, no line breaks, cut to the saved-note length. */
export function cleanNote(note: string): string {
  const flat = note.replace(/\s+/g, " ").trim();
  let end = Math.min(flat.length, ASK_LIMITS.maxMemoryChars);
  const last = flat.charCodeAt(end - 1);
  if (end < flat.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return flat.slice(0, end).trim();
}

export const today = (now: Date): string => now.toISOString().slice(0, 10);

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const validDay = (value: unknown): string | null => {
  if (typeof value !== "string" || !DAY.test(value)) return null;
  return Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? null : value;
};

/** A note as a person sees it created right now. */
export function freshNote(text: string, origin: MemoryOrigin, now: Date): MemoryNote {
  const day = today(now);
  return {
    text,
    origin,
    createdAt: day,
    updatedAt: day,
    reviewAfter: addDays(day, REVIEW_AFTER_DAYS),
    replaced: [],
  };
}

/** A note from `memory.v1`, which recorded nothing but the text. */
export const legacyNote = (text: string): MemoryNote => ({
  text,
  origin: "unknown",
  createdAt: null,
  updatedAt: null,
  reviewAfter: null,
  replaced: [],
});

/** One stored entry, or null when it is unusable. Tolerant per field: a bad field costs only itself. */
function parseNote(entry: unknown): MemoryNote | null {
  if (typeof entry === "string") {
    const text = cleanNote(entry);
    return text === "" ? null : legacyNote(text);
  }
  if (!isRecord(entry) || typeof entry.text !== "string") return null;
  const text = cleanNote(entry.text);
  if (text === "") return null;
  const origin = ORIGINS.find((candidate) => candidate === entry.origin) ?? "unknown";
  const replaced = Array.isArray(entry.replaced)
    ? entry.replaced
        .filter((item): item is string => typeof item === "string")
        .map(cleanNote)
        .filter((item) => item !== "")
        .slice(0, MAX_REPLACED)
    : [];
  return {
    text,
    origin,
    createdAt: validDay(entry.createdAt),
    updatedAt: validDay(entry.updatedAt),
    reviewAfter: validDay(entry.reviewAfter),
    replaced,
  };
}

/** The notes of a stored array: usable entries only, no repeated text, at most the maximum. */
export function sanitizeNotes(entries: unknown[]): MemoryNote[] {
  const notes: MemoryNote[] = [];
  for (const entry of entries) {
    const note = parseNote(entry);
    if (note === null || notes.some((existing) => existing.text === note.text)) continue;
    notes.push(note);
    if (notes.length === ASK_LIMITS.maxMemoryNotes) break;
  }
  return notes;
}

export const textsOf = (notes: readonly MemoryNote[]): string[] => notes.map((note) => note.text);

/**
 * The notes after the person's list of texts became `texts` (an edit, a deletion, an addition):
 * a text that is still there keeps its record; one position that changed while the list kept its
 * length is an edit of that note (origin and creation date stay, the change date moves and the
 * review clock restarts); any other new text is a new note of origin `origin`.
 */
export function reconcileNotes(
  current: readonly MemoryNote[],
  texts: readonly string[],
  now: Date,
  origin: MemoryOrigin = "manual",
): MemoryNote[] {
  const wanted = sanitizeNotes([...texts]).map((note) => note.text);
  const known = new Map(current.map((note) => [note.text, note]));
  const fresh = wanted.filter((text) => !known.has(text));
  const gone = current.filter((note) => !wanted.includes(note.text));
  // One note replaced by one text in the same slot: an edit, not a delete plus an add.
  const edited =
    fresh.length === 1 && gone.length === 1 && wanted.length === current.length
      ? { from: gone[0] as MemoryNote, to: fresh[0] as string }
      : null;
  const day = today(now);
  return wanted.map((text) => {
    const existing = known.get(text);
    if (existing) return existing;
    if (edited && text === edited.to) {
      return {
        ...edited.from,
        text,
        updatedAt: day,
        reviewAfter: addDays(day, REVIEW_AFTER_DAYS),
      };
    }
    return freshNote(text, origin, now);
  });
}

/**
 * The stored list read against the older `memory.v1` mirror. The mirror is the authority on WHICH
 * notes exist: a version that only knows `memory.v1` may have deleted or added notes since this
 * one wrote, and a deleted note must stay deleted. `stored` supplies everything else.
 */
export function mergeWithMirror(
  stored: readonly MemoryNote[] | null,
  mirror: readonly string[],
): MemoryNote[] {
  const known = new Map((stored ?? []).map((note) => [note.text, note]));
  return sanitizeNotes(mirror.map((text) => known.get(text) ?? legacyNote(text)));
}

/** Parses the `memory.v2` text; null when it is absent or not usable as a whole. */
export function parseStored(raw: string | null): MemoryNote[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.v !== 2 || !Array.isArray(parsed.notes)) return null;
    return sanitizeNotes(parsed.notes);
  } catch {
    return null;
  }
}

export const serializeNotes = (notes: readonly MemoryNote[]): string =>
  JSON.stringify({ v: 2, notes: sanitizeNotes([...notes]) });

// ── Review and replacement ─────────────────────────────────────────────────────────────────

/** Whether the note's review day has come. A note with no review day (migrated) is never "due". */
export const isDue = (note: MemoryNote, now: Date): boolean =>
  note.reviewAfter !== null && note.reviewAfter <= today(now);

/** The person says the note still holds: the review clock restarts. */
export function markReviewed(notes: readonly MemoryNote[], text: string, now: Date): MemoryNote[] {
  const day = today(now);
  return notes.map((note) =>
    note.text === text
      ? { ...note, updatedAt: day, reviewAfter: addDays(day, REVIEW_AFTER_DAYS) }
      : note,
  );
}

function pairs(text: string): Set<string> {
  const flat = text.replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i + 1 < flat.length; i++) out.add(flat.slice(i, i + 2));
  return out;
}

/**
 * The saved note `fact` most likely corrects (same topic, different text), or null. A match only
 * proposes a replacement; the person still has to accept the offer that shows it.
 */
export function replacementCandidate(
  notes: readonly MemoryNote[],
  fact: string,
): MemoryNote | null {
  const clean = cleanNote(fact);
  const wanted = pairs(clean);
  let best: { note: MemoryNote; score: number } | null = null;
  for (const note of notes) {
    if (note.text === clean) continue;
    const other = pairs(note.text);
    const smaller = Math.min(wanted.size, other.size);
    if (smaller < MIN_SAME_TOPIC_PAIRS) continue;
    let shared = 0;
    for (const pair of wanted) if (other.has(pair)) shared += 1;
    const score = shared / smaller;
    if (score >= SAME_TOPIC_OVERLAP && (best === null || score > best.score)) {
      best = { note, score };
    }
  }
  return best?.note ?? null;
}

export type Remembered =
  | { kind: "saved"; notes: MemoryNote[]; replaced: string | null }
  | { kind: "same" }
  | { kind: "empty" }
  | { kind: "full" };

/**
 * The person accepted an offer to remember `fact`. A note about the same thing is replaced (the new
 * one records what it replaced); otherwise the note is added if there is room.
 */
export function rememberOffer(notes: readonly MemoryNote[], fact: string, now: Date): Remembered {
  const text = cleanNote(fact);
  if (text === "") return { kind: "empty" };
  if (notes.some((note) => note.text === text)) return { kind: "same" };
  const old = replacementCandidate(notes, text);
  if (old) {
    const note: MemoryNote = {
      ...freshNote(text, "offer_accepted", now),
      replaced: [old.text, ...old.replaced].slice(0, MAX_REPLACED),
    };
    return {
      kind: "saved",
      notes: notes.map((existing) => (existing === old ? note : existing)),
      replaced: old.text,
    };
  }
  if (notes.length >= ASK_LIMITS.maxMemoryNotes) return { kind: "full" };
  return {
    kind: "saved",
    notes: [...notes, freshNote(text, "offer_accepted", now)],
    replaced: null,
  };
}
