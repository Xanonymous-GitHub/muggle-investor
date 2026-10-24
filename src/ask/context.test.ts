import { jsonSchema, type ToolSet, tool } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildRequestContext,
  type ContextBudget,
  estimateTokens,
  estimateToolTokens,
  resultTokens,
  selectNotes,
  wasTrimmed,
} from "./context";
import type { AskRequest } from "./schema";

const BUDGET: ContextBudget = { contextTokens: 20_000, outputTokens: 2_500, resultBytes: 30_000 };
const TOOLS: ToolSet = {
  lookup: tool({
    description: "查詢名詞",
    inputSchema: jsonSchema({ type: "object", properties: { query: { type: "string" } } }),
    execute: async () => ({}),
  }),
};

const PROFILE: AskRequest["profile"] = { holdings: [], memory: [] };

/** A long, varied Traditional-Chinese message: no two are alike, so none is a repeat. */
const longTurn = (n: number, chars = 1200): string =>
  `第${n}段：${"台積電與大盤的走勢需要放在較長的期間來看，不能只看單日漲跌。".repeat(Math.ceil(chars / 30))}`.slice(
    0,
    chars,
  );

const history = (turns: number, chars?: number): AskRequest["messages"] =>
  Array.from({ length: turns * 2 }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: longTurn(i, chars),
  }));

const build = (over: Partial<Parameters<typeof buildRequestContext>[0]> = {}) =>
  buildRequestContext({
    profile: PROFILE,
    messages: [{ role: "user", content: "ETF 是什麼？" }],
    system: "系統提示".repeat(200),
    tools: TOOLS,
    budget: BUDGET,
    ...over,
  });

describe("estimateTokens", () => {
  it("counts CJK denser than Latin and never undercounts the common case", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("台積電")).toBe(5);
    expect(estimateTokens("abcdefghij")).toBe(4);
    // A real Traditional-Chinese tokenizer needs about 1-2 tokens per character.
    expect(estimateTokens("今天大盤收紅".repeat(100))).toBeGreaterThanOrEqual(600);
  });
});

describe("estimateToolTokens / resultTokens", () => {
  it("counts the definitions of the tools, and nothing for no tools", () => {
    expect(estimateToolTokens({})).toBe(0);
    expect(estimateToolTokens(TOOLS)).toBeGreaterThan(20);
  });
  it("turns result bytes into tokens conservatively", () => {
    expect(resultTokens(30_000)).toBe(10_000);
  });
});

describe("buildRequestContext", () => {
  it("passes a short conversation through untouched", () => {
    const messages = [
      { role: "user" as const, content: "你好" },
      { role: "assistant" as const, content: "你好，有什麼想問的？" },
      { role: "user" as const, content: "ETF 是什麼？" },
    ];
    const built = build({ messages });
    expect(built.messages).toEqual(messages);
    expect(wasTrimmed(built)).toBe(false);
    expect(built.fitted).toBe(true);
  });

  it("puts the private note first as a user message, then the conversation", () => {
    const built = build({
      profile: { holdings: [{ symbol: "0050", amount: 300_000 }], memory: ["我想存退休金"] },
    });
    expect(built.messages[0]).toMatchObject({ role: "user" });
    expect(String(built.messages[0]?.content)).toContain("0050");
    expect(String(built.messages[0]?.content)).toContain("我想存退休金");
    expect(built.messages.at(-1)).toEqual({ role: "user", content: "ETF 是什麼？" });
  });

  it("trims a large Traditional-Chinese history oldest-first within the budget", () => {
    const messages = [...history(10), { role: "user" as const, content: "那現在該怎麼看？" }];
    const built = build({ messages });
    expect(built.droppedMessages).toBeGreaterThan(0);
    expect(built.estimatedTokens).toBeLessThanOrEqual(BUDGET.contextTokens);
    // The newest messages survive as one run, and the current question is last and unchanged.
    expect(built.messages.at(-1)).toEqual({ role: "user", content: "那現在該怎麼看？" });
    const kept = built.messages.slice(0, -1);
    const expected = messages.slice(messages.length - 1 - kept.length, -1);
    expect(kept).toEqual(expected);
    expect(wasTrimmed(built)).toBe(true);
  });

  it("never starts the kept history with an assistant message", () => {
    const messages = [...history(10), { role: "user" as const, content: "最後一題" }];
    for (const contextTokens of [9_000, 10_500, 12_000, 14_000, 16_000]) {
      const built = build({ messages, budget: { ...BUDGET, contextTokens } });
      expect(built.messages[0]?.role).toBe("user");
    }
  });

  it("keeps the current question even when nothing else fits", () => {
    const question = longTurn(99, 3000);
    const built = build({
      messages: [...history(3), { role: "user", content: question }],
      budget: { ...BUDGET, contextTokens: 3_000 },
    });
    expect(built.fitted).toBe(false);
    expect(built.messages).toEqual([{ role: "user", content: question }]);
    expect(built.droppedMessages).toBe(6);
  });

  it("reserves output, tool results and the system prompt before any message", () => {
    const messages = [...history(4), { role: "user" as const, content: "最後一題" }];
    const roomy = build({ messages, budget: { ...BUDGET, contextTokens: 40_000 } });
    const withoutTools = build({
      messages,
      tools: {},
      budget: { ...BUDGET, contextTokens: 16_000 },
    });
    const withTools = build({ messages, budget: { ...BUDGET, contextTokens: 16_000 } });
    expect(roomy.droppedMessages).toBe(0);
    // The same budget keeps less once tool definitions and the reserved results come out of it.
    expect(withTools.droppedMessages).toBeGreaterThan(withoutTools.droppedMessages);
    expect(withTools.estimatedTokens).toBeLessThanOrEqual(16_000);
  });

  it("leaves the profile out only when even it does not fit, and says so", () => {
    const profile = {
      holdings: Array.from({ length: 30 }, (_, i) => ({ symbol: `00${i + 10}`, amount: 1000 * i })),
      memory: ["我想存退休金"],
    };
    const built = build({ profile, budget: { ...BUDGET, contextTokens: 7_700 } });
    expect(built.droppedProfile).toBe(true);
    expect(built.droppedNotes).toBe(1);
    expect(built.messages).toEqual([{ role: "user", content: "ETF 是什麼？" }]);
  });

  it("is deterministic", () => {
    const messages = [...history(8), { role: "user" as const, content: "最後一題" }];
    expect(build({ messages })).toEqual(build({ messages }));
  });
});

describe("selectNotes", () => {
  const notes = [
    "我想存退休金，二十年後用",
    "我不喜歡太大的波動",
    "我已經有一筆緊急預備金",
    "我每個月可以投入一萬元",
  ];

  it("keeps every note when they all fit", () => {
    expect(selectNotes(notes, "ETF 是什麼？", 10_000)).toEqual({ kept: notes, dropped: 0 });
  });

  it("keeps the notes closest to the question first, in their original order", () => {
    const cost = estimateTokens(notes[0] as string) + 4;
    const { kept, dropped } = selectNotes(notes, "我每個月可以投入多少錢到退休金？", cost * 2 + 2);
    expect(dropped).toBe(2);
    expect(kept).toEqual([notes[0], notes[3]]);
  });

  it("falls back to the most recent notes when none matches", () => {
    const cost = estimateTokens(notes[0] as string) + 4;
    const { kept } = selectNotes(notes, "xyz", cost * 2 + 2);
    expect(kept).toEqual([notes[2], notes[3]]);
  });

  it("keeps nothing when the share is zero", () => {
    expect(selectNotes(notes, "退休金", 0)).toEqual({ kept: [], dropped: 4 });
  });
});
