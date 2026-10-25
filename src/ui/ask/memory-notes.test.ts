import { describe, expect, it } from "vitest";
import {
  cleanNote,
  freshNote,
  isDue,
  legacyNote,
  markReviewed,
  mergeWithMirror,
  parseStored,
  reconcileNotes,
  rememberOffer,
  replacementCandidate,
  sanitizeNotes,
  serializeNotes,
  textsOf,
} from "./memory-notes";

const DAY1 = new Date("2026-01-10T03:00:00Z");
const DAY2 = new Date("2026-03-01T03:00:00Z");
const LATER = new Date("2026-07-20T03:00:00Z");

describe("freshNote / isDue / markReviewed", () => {
  it("dates a new note and schedules its review 180 days out", () => {
    expect(freshNote("我想存退休金", "manual", DAY1)).toEqual({
      text: "我想存退休金",
      origin: "manual",
      createdAt: "2026-01-10",
      updatedAt: "2026-01-10",
      reviewAfter: "2026-07-09",
      replaced: [],
    });
  });

  it("is due on and after the review day, never for a migrated note", () => {
    const note = freshNote("a", "manual", DAY1);
    expect(isDue(note, new Date("2026-07-08T00:00:00Z"))).toBe(false);
    expect(isDue(note, new Date("2026-07-09T00:00:00Z"))).toBe(true);
    expect(isDue(legacyNote("a"), LATER)).toBe(false);
  });

  it("restarts the clock for the confirmed note only", () => {
    const notes = [freshNote("a", "manual", DAY1), freshNote("b", "manual", DAY1)];
    const [a, b] = markReviewed(notes, "a", LATER);
    expect(a?.reviewAfter).toBe("2027-01-16");
    expect(a?.updatedAt).toBe("2026-07-20");
    expect(a?.createdAt).toBe("2026-01-10");
    expect(b).toEqual(notes[1]);
  });
});

describe("sanitizeNotes", () => {
  it("accepts old strings and records, drops the unusable, and keeps one note per text", () => {
    const notes = sanitizeNotes([
      "  舊的\n一則 ",
      { text: "新的", origin: "offer_accepted", createdAt: "2026-01-10", reviewAfter: "bad" },
      { text: "新的", origin: "manual" },
      { text: "" },
      { origin: "manual" },
      42,
      null,
      ["x"],
    ]);
    expect(textsOf(notes)).toEqual(["舊的 一則", "新的"]);
    expect(notes[0]).toMatchObject({ origin: "unknown", createdAt: null });
    expect(notes[1]).toMatchObject({
      origin: "offer_accepted",
      createdAt: "2026-01-10",
      reviewAfter: null,
    });
  });

  it("falls back to origin unknown for an origin it does not know, field by field", () => {
    const [note] = sanitizeNotes([
      { text: "a", origin: "from-the-future", createdAt: "2026-02-30x", replaced: ["x", 1, ""] },
    ]);
    expect(note).toMatchObject({ origin: "unknown", createdAt: null, replaced: ["x"] });
  });

  it("caps the list and the length of a note", () => {
    const many = Array.from({ length: 30 }, (_, i) => `note ${i}`);
    expect(sanitizeNotes(many)).toHaveLength(20);
    expect(cleanNote("y".repeat(500))).toHaveLength(200);
  });
});

describe("parseStored / serializeNotes", () => {
  it("round-trips", () => {
    const notes = [freshNote("a", "manual", DAY1), legacyNote("b")];
    expect(parseStored(serializeNotes(notes))).toEqual(notes);
  });

  it.each([
    [null],
    ["garbage"],
    ["[]"],
    ['{"v":1,"notes":[]}'],
    ['{"v":2}'],
    ['{"v":2,"notes":"x"}'],
  ])("is null for %s (not usable as a whole)", (raw) => {
    expect(parseStored(raw)).toBeNull();
  });

  it("keeps the usable entries of a partly damaged list", () => {
    const raw = JSON.stringify({ v: 2, notes: [{ text: "ok" }, 7, { text: "" }, "also ok"] });
    expect(textsOf(parseStored(raw) ?? [])).toEqual(["ok", "also ok"]);
  });
});

describe("mergeWithMirror (memory.v1 decides which notes exist)", () => {
  const stored = [freshNote("a", "offer_accepted", DAY1), freshNote("b", "manual", DAY1)];

  it("migrates a v1-only list as origin unknown", () => {
    const notes = mergeWithMirror(null, ["a", "b"]);
    expect(notes.map((n) => n.origin)).toEqual(["unknown", "unknown"]);
    expect(notes.every((n) => n.createdAt === null)).toBe(true);
  });

  it("keeps the records of notes both versions know, in the mirror's order", () => {
    const notes = mergeWithMirror(stored, ["b", "a"]);
    expect(notes).toEqual([stored[1], stored[0]]);
  });

  it("drops a note an older version deleted, and adds one it wrote as unknown", () => {
    const notes = mergeWithMirror(stored, ["b", "c"]);
    expect(textsOf(notes)).toEqual(["b", "c"]);
    expect(notes[1]?.origin).toBe("unknown");
  });

  it("brings nothing back when the mirror is empty", () => {
    expect(mergeWithMirror(stored, [])).toEqual([]);
  });
});

describe("reconcileNotes", () => {
  const current = [freshNote("a", "offer_accepted", DAY1), freshNote("b", "manual", DAY1)];

  it("keeps unchanged notes exactly", () => {
    expect(reconcileNotes(current, ["a", "b"], DAY2)).toEqual(current);
  });

  it("treats one changed slot as an edit: origin and creation stay, change date and review move", () => {
    const [a, edited] = reconcileNotes(current, ["a", "b 改過"], DAY2);
    expect(a).toEqual(current[0]);
    expect(edited).toMatchObject({
      text: "b 改過",
      origin: "manual",
      createdAt: "2026-01-10",
      updatedAt: "2026-03-01",
      reviewAfter: "2026-08-28",
    });
  });

  it("treats an addition as a new note of the given origin, and a deletion as gone", () => {
    const added = reconcileNotes(current, ["a", "b", "c"], DAY2, "manual");
    expect(added[2]).toMatchObject({ text: "c", origin: "manual", createdAt: "2026-03-01" });
    expect(textsOf(reconcileNotes(current, ["b"], DAY2))).toEqual(["b"]);
  });

  it("is not fooled into an edit by a delete plus an add of a different count", () => {
    const next = reconcileNotes(current, ["x", "y", "z"], DAY2);
    expect(next.every((n) => n.origin === "manual" && n.createdAt === "2026-03-01")).toBe(true);
  });

  it("collapses repeated texts", () => {
    expect(textsOf(reconcileNotes([], ["a", "a", " a "], DAY1))).toEqual(["a"]);
  });
});

describe("replacementCandidate / rememberOffer", () => {
  const notes = [
    freshNote("我想存退休金，二十年後用", "manual", DAY1),
    freshNote("我不喜歡太大的波動", "manual", DAY1),
  ];

  it("finds the note about the same thing and not unrelated ones", () => {
    expect(replacementCandidate(notes, "我想存退休金，十五年後用")?.text).toBe(
      "我想存退休金，二十年後用",
    );
    expect(replacementCandidate(notes, "我每個月可以投入一萬元")).toBeNull();
    expect(replacementCandidate(notes, "我想存退休金，二十年後用")).toBeNull();
  });

  it("replaces the old note, recording it, when the person accepts", () => {
    const result = rememberOffer(notes, "我想存退休金，十五年後用", LATER);
    if (result.kind !== "saved") throw new Error(result.kind);
    expect(result.replaced).toBe("我想存退休金，二十年後用");
    expect(textsOf(result.notes)).toEqual(["我想存退休金，十五年後用", "我不喜歡太大的波動"]);
    expect(result.notes[0]).toMatchObject({
      origin: "offer_accepted",
      replaced: ["我想存退休金，二十年後用"],
    });
  });

  it("adds an unrelated note as offer_accepted", () => {
    const result = rememberOffer(notes, "我每個月可以投入一萬元", LATER);
    if (result.kind !== "saved") throw new Error(result.kind);
    expect(result.replaced).toBeNull();
    expect(result.notes.at(-1)).toMatchObject({
      origin: "offer_accepted",
      createdAt: "2026-07-20",
    });
  });

  it("changes nothing for a repeat or an empty offer", () => {
    expect(rememberOffer(notes, " 我不喜歡太大的波動 ", LATER).kind).toBe("same");
    expect(rememberOffer(notes, " \n ", LATER).kind).toBe("empty");
  });

  it("is full at the maximum, unless the offer replaces a note", () => {
    const full = Array.from({ length: 20 }, (_, i) =>
      freshNote(`第${i}則 完全不同的內容${i}${i}`, "manual", DAY1),
    );
    expect(rememberOffer(full, "一則全新的事情要記住", LATER).kind).toBe("full");
    const same = rememberOffer(full, "第3則 完全不同的內容3x", LATER);
    expect(same.kind).toBe("saved");
    if (same.kind === "saved") expect(same.notes).toHaveLength(20);
  });

  it("keeps at most three replaced texts, newest first", () => {
    let current = [freshNote("我想存退休金，二十年後用", "manual", DAY1)];
    for (const text of [
      "我想存退休金，十九年後用",
      "我想存退休金，十八年後用",
      "我想存退休金，十七年後用",
      "我想存退休金，十六年後用",
    ]) {
      const result = rememberOffer(current, text, LATER);
      if (result.kind !== "saved") throw new Error(result.kind);
      current = result.notes;
    }
    expect(current[0]?.replaced).toEqual([
      "我想存退休金，十七年後用",
      "我想存退休金，十八年後用",
      "我想存退休金，十九年後用",
    ]);
  });
});
