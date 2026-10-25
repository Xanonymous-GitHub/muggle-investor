import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMemoryNote,
  clearAllAskData,
  clearChat,
  clearHoldings,
  clearMemory,
  isNoteTooLong,
  parseChat,
  parseHoldings,
  parseMemory,
  readAck,
  readChat,
  readHoldings,
  readMemory,
  readMemoryNotes,
  readPlanOptIn,
  rememberFact,
  reviewMemoryNote,
  writeAck,
  writeChat,
  writeHoldings,
  writeMemory,
  writePlanOptIn,
} from "@/ui/ask/stores";
import { keysWithPrefix, readItem, writeItem } from "@/ui/device/storage";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const msg = (role: "user" | "assistant", content: string) => ({ role, content });

describe("parseChat", () => {
  it("returns [] for null, corrupt JSON and wrong shapes", () => {
    expect(parseChat(null)).toEqual([]);
    expect(parseChat("{not json")).toEqual([]);
    expect(parseChat('"text"')).toEqual([]);
    expect(parseChat('{"role":"user","content":"x"}')).toEqual([]);
    expect(parseChat("42")).toEqual([]);
  });

  it("keeps valid messages and drops bad entries", () => {
    const raw = JSON.stringify([
      msg("user", "hi"),
      { role: "system", content: "no" },
      { role: "user", content: 5 },
      { role: "user", content: "" },
      null,
      "str",
      [],
      msg("assistant", "hello"),
    ]);
    expect(parseChat(raw)).toEqual([msg("user", "hi"), msg("assistant", "hello")]);
  });

  it("keeps `partial: true` on a message and ignores any other value", () => {
    const raw = JSON.stringify([
      { role: "assistant", content: "a", partial: true },
      { role: "assistant", content: "b", partial: false },
      { role: "assistant", content: "c", partial: "true" },
      { role: "assistant", content: "d", partial: 1 },
      { role: "assistant", content: "e" },
    ]);
    expect(parseChat(raw)).toEqual([
      { role: "assistant", content: "a", partial: true },
      msg("assistant", "b"),
      msg("assistant", "c"),
      msg("assistant", "d"),
      msg("assistant", "e"),
    ]);
  });

  it("writeChat keeps `partial: true` through a round trip", () => {
    writeChat([msg("user", "q"), { role: "assistant", content: "半", partial: true }]);
    expect(readChat()).toEqual([
      msg("user", "q"),
      { role: "assistant", content: "半", partial: true },
    ]);
  });

  it("strips extra keys, including prototype keys", () => {
    const raw =
      '[{"role":"user","content":"hi","__proto__":{"polluted":true},"constructor":"x","extra":1}]';
    const [first] = parseChat(raw);
    expect(Object.keys(first ?? {}).sort()).toEqual(["content", "role"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps only the newest 20", () => {
    const many = Array.from({ length: 25 }, (_, i) => msg("user", `m${i}`));
    const parsed = parseChat(JSON.stringify(many));
    expect(parsed).toHaveLength(20);
    expect(parsed[0]?.content).toBe("m5");
    expect(parsed.at(-1)?.content).toBe("m24");
  });

  it("cuts an over-long message to 4000 characters", () => {
    const parsed = parseChat(JSON.stringify([msg("assistant", "x".repeat(4001))]));
    expect(parsed[0]?.content).toHaveLength(4000);
  });

  it("does not split a surrogate pair when cutting", () => {
    const content = `${"x".repeat(3999)}😀tail`;
    const cut = parseChat(JSON.stringify([msg("assistant", content)]))[0]?.content ?? "";
    expect(cut).toBe("x".repeat(3999));
  });

  it("ignores a 5 MB blob instead of parsing it", () => {
    const huge = JSON.stringify([msg("user", "a".repeat(5 * 1024 * 1024))]);
    expect(parseChat(huge)).toEqual([]);
  });
});

describe("parseHoldings", () => {
  it("returns [] for null, corrupt JSON and wrong shapes", () => {
    expect(parseHoldings(null)).toEqual([]);
    expect(parseHoldings("nope")).toEqual([]);
    expect(parseHoldings('{"symbol":"0050"}')).toEqual([]);
  });

  it("keeps valid holdings with only the schema keys", () => {
    const raw = JSON.stringify([
      { symbol: "0050", amount: 100000, quantity: 10, extra: "x" },
      { symbol: "VT" },
    ]);
    expect(parseHoldings(raw)).toEqual([
      { symbol: "0050", amount: 100000, quantity: 10 },
      { symbol: "VT" },
    ]);
  });

  it("drops entries whose symbol does not match", () => {
    const raw = JSON.stringify([
      { symbol: "A" },
      { symbol: "abc def" },
      { symbol: "ABCDEFGHIJK" },
      { symbol: "台積電" },
      { symbol: 50 },
      { amount: 5 },
      { symbol: "ok" },
    ]);
    expect(parseHoldings(raw)).toEqual([{ symbol: "ok" }]);
  });

  it("drops a negative, fractional, huge or non-numeric amount but keeps the holding", () => {
    const raw = JSON.stringify([
      { symbol: "AA", amount: -1, quantity: 3 },
      { symbol: "BB", amount: 1.5 },
      { symbol: "CC", amount: 1_000_000_001 },
      { symbol: "DD", amount: "5", quantity: 0 },
      { symbol: "EE", amount: 1_000_000_000 },
    ]);
    expect(parseHoldings(raw)).toEqual([
      { symbol: "AA", quantity: 3 },
      { symbol: "BB" },
      { symbol: "CC" },
      { symbol: "DD", quantity: 0 },
      { symbol: "EE", amount: 1_000_000_000 },
    ]);
  });

  it("keeps at most 30", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ symbol: `S${i + 10}` }));
    const parsed = parseHoldings(JSON.stringify(many));
    expect(parsed).toHaveLength(30);
    expect(parsed[0]?.symbol).toBe("S10");
  });

  it("ignores prototype keys and a 5 MB blob", () => {
    const parsed = parseHoldings('[{"symbol":"AB","__proto__":{"amount":5},"constructor":1}]');
    expect(parsed).toEqual([{ symbol: "AB" }]);
    expect(parseHoldings(`["${"a".repeat(5 * 1024 * 1024)}"]`)).toEqual([]);
  });
});

describe("parseMemory", () => {
  it("returns [] for null, corrupt JSON and wrong shapes", () => {
    expect(parseMemory(null)).toEqual([]);
    expect(parseMemory("[")).toEqual([]);
    expect(parseMemory('{"a":"b"}')).toEqual([]);
  });

  it("keeps strings, normalised, and drops the rest", () => {
    const raw = JSON.stringify([
      "  喜歡 ETF \n 定期定額 ",
      5,
      "",
      "   ",
      null,
      "喜歡 ETF 定期定額",
      "b",
    ]);
    expect(parseMemory(raw)).toEqual(["喜歡 ETF 定期定額", "b"]);
  });

  it("cuts a 201-character note to 200", () => {
    const parsed = parseMemory(JSON.stringify(["x".repeat(201)]));
    expect(parsed[0]).toHaveLength(200);
  });

  it("keeps at most 20 and rejects a 5 MB blob", () => {
    const many = Array.from({ length: 25 }, (_, i) => `n${i}`);
    expect(parseMemory(JSON.stringify(many))).toHaveLength(20);
    expect(parseMemory(JSON.stringify(["a".repeat(5 * 1024 * 1024)]))).toEqual([]);
  });
});

describe("addMemoryNote", () => {
  it("adds a trimmed one-line note", () => {
    expect(addMemoryNote(["a"], "  hello \n\t world  ")).toEqual(["a", "hello world"]);
  });

  it("returns the same list for an empty note", () => {
    const notes = ["a"];
    expect(addMemoryNote(notes, " \n ")).toBe(notes);
  });

  it("returns the same list for a duplicate after trimming", () => {
    const notes = ["hello world"];
    expect(addMemoryNote(notes, "  hello \n world ")).toBe(notes);
  });

  it("caps a note at 200 characters", () => {
    const [note] = addMemoryNote([], "y".repeat(500));
    expect(note).toHaveLength(200);
  });

  it("stops at 20 notes and returns the same list", () => {
    const notes = Array.from({ length: 20 }, (_, i) => `n${i}`);
    expect(addMemoryNote(notes, "twenty-first")).toBe(notes);
  });

  it("does not mutate its input", () => {
    const notes = ["a"];
    addMemoryNote(notes, "b");
    expect(notes).toEqual(["a"]);
  });
});

describe("device round trips", () => {
  it("chat, holdings and memory survive write then read, and clear", () => {
    expect(writeChat([msg("user", "q"), msg("assistant", "a")])).toBe(true);
    expect(readChat()).toEqual([msg("user", "q"), msg("assistant", "a")]);
    expect(writeHoldings([{ symbol: "0050", amount: 5 }])).toBe(true);
    expect(readHoldings()).toEqual([{ symbol: "0050", amount: 5 }]);
    expect(writeMemory(["note"])).toBe(true);
    expect(readMemory()).toEqual(["note"]);
    clearChat();
    clearHoldings();
    clearMemory();
    expect(readChat()).toEqual([]);
    expect(readHoldings()).toEqual([]);
    expect(readMemory()).toEqual([]);
    expect(readItem("muggle.ask.chat.v1")).toBeNull();
  });

  it("writeChat stores only role and content, newest 20", () => {
    const many = Array.from({ length: 22 }, (_, i) => ({
      ...msg("user", `m${i}`),
      notices: ["x"],
    }));
    writeChat(many);
    const stored = JSON.parse(readItem("muggle.ask.chat.v1") ?? "[]");
    expect(stored).toHaveLength(20);
    expect(stored[0]).toEqual(msg("user", "m2"));
  });

  it("reads tolerate stored garbage", () => {
    writeItem("muggle.ask.chat.v1", "garbage");
    writeItem("muggle.ask.holdings.v1", "garbage");
    writeItem("muggle.ask.memory.v1", "garbage");
    expect(readChat()).toEqual([]);
    expect(readHoldings()).toEqual([]);
    expect(readMemory()).toEqual([]);
  });

  it("writes report false when storage refuses and never throw", () => {
    const refuse = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      expect(writeChat([msg("user", "q")])).toBe(false);
      expect(writeHoldings([])).toBe(false);
      expect(writeMemory([])).toBe(false);
      expect(writePlanOptIn(true)).toBe(false);
      expect(writeAck()).toBe(false);
    } finally {
      // Restored by hand: the spy sits on the shared localStorage object.
      refuse.mockRestore();
    }
  });

  it("reads fall back when window.localStorage throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readChat()).toEqual([]);
    expect(readPlanOptIn()).toBe(false);
    expect(readAck()).toBe(false);
    expect(() => clearAllAskData()).not.toThrow();
  });
});

describe("plan opt-in and acknowledgement", () => {
  it("default to off and not acknowledged", () => {
    expect(readPlanOptIn()).toBe(false);
    expect(readAck()).toBe(false);
  });

  it("round-trip", () => {
    writePlanOptIn(true);
    expect(readPlanOptIn()).toBe(true);
    writePlanOptIn(false);
    expect(readPlanOptIn()).toBe(false);
    writeAck();
    expect(readAck()).toBe(true);
  });

  it("treat garbage as the default", () => {
    writeItem("muggle.ask.profile.v1", "garbage");
    writeItem("muggle.ask.ack.v1", '{"ack":"yes"}');
    expect(readPlanOptIn()).toBe(false);
    expect(readAck()).toBe(false);
    writeItem("muggle.ask.profile.v1", '{"plan":"true"}');
    expect(readPlanOptIn()).toBe(false);
  });
});

describe("clearAllAskData", () => {
  it("removes every muggle.ask.* key and nothing else", () => {
    writeChat([msg("user", "q")]);
    writeHoldings([{ symbol: "AB" }]);
    writeMemory(["m"]);
    writePlanOptIn(true);
    writeAck();
    writeItem("muggle.ask.future.v9", "x");
    writeItem("muggle.plan.draft.v1", "keep");
    writeItem("muggle.settings", "keep");
    clearAllAskData();
    expect(keysWithPrefix("").sort()).toEqual(["muggle.plan.draft.v1", "muggle.settings"]);
  });
});

describe("isNoteTooLong", () => {
  it("measures the one-line form that would be saved", () => {
    expect(isNoteTooLong("a".repeat(200))).toBe(false);
    expect(isNoteTooLong("a".repeat(201))).toBe(true);
    // Runs of whitespace and the ends collapse before counting, as in normalizeNote.
    expect(isNoteTooLong(`  ${"a ".repeat(100)}\n\n${" ".repeat(50)}`)).toBe(false);
    expect(isNoteTooLong("")).toBe(false);
  });
});

describe("memory v2 (records, migration, rollback)", () => {
  const V1 = "muggle.ask.memory.v1";
  const V2 = "muggle.ask.memory.v2";
  const stored = (key: string) => window.localStorage.getItem(key);

  it("migrates a memory.v1 list as origin unknown, without rewriting storage on read", () => {
    writeItem(V1, JSON.stringify(["舊的一則", "另一則"]));
    const notes = readMemoryNotes();
    expect(notes.map((n) => [n.text, n.origin, n.createdAt])).toEqual([
      ["舊的一則", "unknown", null],
      ["另一則", "unknown", null],
    ]);
    expect(readMemory()).toEqual(["舊的一則", "另一則"]);
    expect(stored(V2)).toBeNull();
  });

  it("writes both keys: v1 carries only the texts, v2 the records", () => {
    expect(writeMemory(["a", "b"], new Date("2026-01-10T00:00:00Z"))).toBe(true);
    expect(JSON.parse(stored(V1) ?? "null")).toEqual(["a", "b"]);
    expect(JSON.parse(stored(V2) ?? "null")).toMatchObject({ v: 2 });
    expect(readMemoryNotes()[0]).toMatchObject({ origin: "manual", createdAt: "2026-01-10" });
  });

  it("keeps a note's record through an edit of its text", () => {
    expect(rememberFact("我想存退休金", new Date("2026-01-10T00:00:00Z"))).toBe("saved");
    writeMemory(["我想存退休金，二十年後用"], new Date("2026-03-01T00:00:00Z"));
    expect(readMemoryNotes()[0]).toMatchObject({
      origin: "offer_accepted",
      createdAt: "2026-01-10",
      updatedAt: "2026-03-01",
    });
  });

  it("honours a deletion made by an older version that only knows memory.v1", () => {
    writeMemory(["a", "b"]);
    writeItem(V1, JSON.stringify(["b"]));
    expect(readMemory()).toEqual(["b"]);
    writeItem(V1, JSON.stringify([]));
    expect(readMemoryNotes()).toEqual([]);
    window.localStorage.removeItem(V1);
    expect(readMemory()).toEqual([]);
  });

  it("takes in a note an older version added, as origin unknown", () => {
    writeMemory(["a"]);
    writeItem(V1, JSON.stringify(["a", "added by the old version"]));
    expect(readMemoryNotes().map((n) => [n.text, n.origin])).toEqual([
      ["a", "manual"],
      ["added by the old version", "unknown"],
    ]);
  });

  it("survives damaged storage in either key", () => {
    writeMemory(["a", "b"]);
    writeItem(V2, "{not json");
    expect(readMemory()).toEqual(["a", "b"]);
    expect(readMemoryNotes().every((n) => n.origin === "unknown")).toBe(true);
    writeItem(V1, "garbage");
    writeItem(V2, JSON.stringify({ v: 2, notes: [{ text: "x" }] }));
    expect(readMemory()).toEqual([]);
    writeItem(V1, JSON.stringify([{ nope: 1 }, 5, "ok", "ok"]));
    expect(readMemory()).toEqual(["ok"]);
  });

  it("collapses duplicates and never exceeds twenty notes", () => {
    writeMemory(["a", "a", " a "]);
    expect(readMemory()).toEqual(["a"]);
    writeMemory(Array.from({ length: 25 }, (_, i) => `n${i}`));
    expect(readMemory()).toHaveLength(20);
  });

  describe("an offer the person accepts", () => {
    it("is saved once, with its origin, and a repeat changes nothing", () => {
      expect(rememberFact("我想存退休金")).toBe("saved");
      expect(rememberFact(" 我想存退休金 ")).toBe("saved");
      expect(readMemoryNotes()).toHaveLength(1);
      expect(readMemoryNotes()[0]?.origin).toBe("offer_accepted");
    });

    it("replaces a note about the same thing and remembers what it replaced", () => {
      writeMemory(["我想存退休金，二十年後用", "我不喜歡太大的波動"]);
      expect(rememberFact("我想存退休金，十五年後用")).toBe("saved");
      expect(readMemory()).toEqual(["我想存退休金，十五年後用", "我不喜歡太大的波動"]);
      expect(readMemoryNotes()[0]?.replaced).toEqual(["我想存退休金，二十年後用"]);
      // The server sees only the texts.
      expect(stored(V1)).not.toContain("二十年後");
    });

    it("reports a full list and an unwritable device, and writes nothing in either case", () => {
      writeMemory(Array.from({ length: 20 }, (_, i) => `第${i}則 內容完全不同${i}${i}${i}`));
      const before = stored(V1);
      expect(rememberFact("一則全新的事情要記住")).toBe("full");
      expect(stored(V1)).toBe(before);
      clearMemory();
      const refuse = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      try {
        expect(rememberFact("可以記住的事情")).toBe("failed");
        expect(rememberFact(" ")).toBe("failed");
      } finally {
        refuse.mockRestore();
      }
    });
  });

  it("restarts the review clock of one note", () => {
    writeMemory(["a", "b"], new Date("2026-01-10T00:00:00Z"));
    expect(reviewMemoryNote("a", new Date("2026-07-20T00:00:00Z"))).toBe(true);
    const [a, b] = readMemoryNotes();
    expect(a?.reviewAfter).toBe("2027-01-16");
    expect(b?.reviewAfter).toBe("2026-07-09");
  });

  it("clears both keys with clearMemory and with clear-all", () => {
    writeMemory(["a"]);
    expect(clearMemory()).toBe(true);
    expect(stored(V1)).toBeNull();
    expect(stored(V2)).toBeNull();
    writeMemory(["a"]);
    writeChat([msg("user", "hi")]);
    clearAllAskData();
    expect(keysWithPrefix("muggle.ask.")).toEqual([]);
    expect(readMemory()).toEqual([]);
  });
});
