import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMemoryNote,
  clearAllAskData,
  clearChat,
  clearHoldings,
  clearMemory,
  parseChat,
  parseHoldings,
  parseMemory,
  readAck,
  readChat,
  readHoldings,
  readMemory,
  readPlanOptIn,
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
