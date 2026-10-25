import { describe, expect, it } from "vitest";
import { MAX_AMOUNT } from "@/planner/schema";
import {
  askRequestSchema,
  MAX_ASK_BODY_BYTES,
  MAX_HOLDINGS,
  MAX_MEMORY_CHARS,
  MAX_MEMORY_NOTES,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  privateValues,
} from "./schema";

const PLAN = {
  answers: {
    age: "age-40-49",
    horizon: "horizon-5-10y",
    income: "income-stable",
    reserve: "reserve-3-6m",
    loss: "loss-hold",
  },
  lump: 654_321,
  monthly: 12_345,
  monthlyExpenses: 31_234,
  existingReserve: 987_654,
};

const VALID = {
  lens: "beginner",
  messages: [{ role: "user", content: "0050 是什麼？" }],
};

const parse = (overrides: Record<string, unknown>) =>
  askRequestSchema.safeParse({ ...VALID, ...overrides });

describe("ask limits", () => {
  it("pins the documented caps", () => {
    expect(MAX_ASK_BODY_BYTES).toBe(65_536);
    expect(MAX_MESSAGES).toBe(20);
    expect(MAX_MESSAGE_CHARS).toBe(4000);
    expect(MAX_HOLDINGS).toBe(30);
    expect(MAX_MEMORY_NOTES).toBe(20);
    expect(MAX_MEMORY_CHARS).toBe(200);
  });
});

describe("askRequestSchema", () => {
  it("accepts a full request", () => {
    const result = parse({
      lens: "pro",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "and 0056?" },
      ],
      profile: {
        plan: PLAN,
        holdings: [
          { symbol: "0050", amount: 100_000, quantity: 1000 },
          { symbol: "00878", amount: 0 },
          { symbol: "2330" },
        ],
        memory: ["prefers dividends"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("fills the profile defaults", () => {
    const result = parse({});
    expect(result.success).toBe(true);
    expect(result.data?.profile).toEqual({ holdings: [], memory: [] });
  });

  it("fills holdings and memory when only the plan is given", () => {
    const result = parse({ profile: { plan: PLAN } });
    expect(result.data?.profile.holdings).toEqual([]);
    expect(result.data?.profile.memory).toEqual([]);
  });

  it("strips unknown keys", () => {
    const result = parse({
      extra: 1,
      messages: [{ role: "user", content: "hi", id: "x" }],
      profile: { holdings: [{ symbol: "0050", note: "n" }], other: true },
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      lens: "beginner",
      messages: [{ role: "user", content: "hi" }],
      profile: { holdings: [{ symbol: "0050" }], memory: [] },
    });
  });

  it.each([
    ["no messages", { messages: [] }],
    [
      "21 messages",
      {
        messages: Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: "x",
        })).reverse(),
      },
    ],
    ["empty content", { messages: [{ role: "user", content: "" }] }],
    ["4001 chars", { messages: [{ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS + 1) }] }],
    [
      "the last message from the assistant",
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      },
    ],
    ["an unknown role", { messages: [{ role: "system", content: "hi" }] }],
    ["an unknown lens", { lens: "expert" }],
    ["a missing lens", { lens: undefined }],
    [
      "31 holdings",
      {
        profile: {
          holdings: Array.from({ length: MAX_HOLDINGS + 1 }, () => ({ symbol: "0050" })),
        },
      },
    ],
    ["a symbol with a space", { profile: { holdings: [{ symbol: "00 50" }] } }],
    ["a one-character symbol", { profile: { holdings: [{ symbol: "5" }] } }],
    ["an 11-character symbol", { profile: { holdings: [{ symbol: "A".repeat(11) }] } }],
    ["a negative amount", { profile: { holdings: [{ symbol: "0050", amount: -1 }] } }],
    ["a fractional amount", { profile: { holdings: [{ symbol: "0050", amount: 1.5 }] } }],
    [
      "an amount over the cap",
      { profile: { holdings: [{ symbol: "0050", amount: MAX_AMOUNT + 1 }] } },
    ],
    ["a negative quantity", { profile: { holdings: [{ symbol: "0050", quantity: -1 }] } }],
    ["a fractional quantity", { profile: { holdings: [{ symbol: "0050", quantity: 0.5 }] } }],
    [
      "21 memory notes",
      { profile: { memory: Array.from({ length: MAX_MEMORY_NOTES + 1 }, () => "n") } },
    ],
    ["a 201-char memory note", { profile: { memory: ["x".repeat(MAX_MEMORY_CHARS + 1)] } }],
    ["an empty memory note", { profile: { memory: [""] } }],
    ["an invalid plan", { profile: { plan: { ...PLAN, lump: 0, monthly: 0 } } }],
  ])("rejects %s", (_label, overrides) => {
    expect(parse(overrides).success).toBe(false);
  });

  it("accepts the boundary values", () => {
    const result = parse({
      messages: Array.from({ length: MAX_MESSAGES }, (_, i) => ({
        role: i % 2 === 0 ? "assistant" : "user",
        content: "x".repeat(MAX_MESSAGE_CHARS),
      })),
      profile: {
        holdings: Array.from({ length: MAX_HOLDINGS }, () => ({
          symbol: "0050",
          amount: MAX_AMOUNT,
          quantity: MAX_AMOUNT,
        })),
        memory: Array.from({ length: MAX_MEMORY_NOTES }, () => "x".repeat(MAX_MEMORY_CHARS)),
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.messages).toHaveLength(MAX_MESSAGES);
  });
});

describe("privateValues", () => {
  it("lists every plan amount, holding amount and quantity, and memory note", () => {
    const parsed = askRequestSchema.parse({
      ...VALID,
      profile: {
        plan: PLAN,
        holdings: [{ symbol: "0050", amount: 100_000, quantity: 2000 }, { symbol: "2330" }],
        memory: ["wants a house", "no crypto"],
      },
    });
    const { numbers, texts } = privateValues(parsed.profile);
    expect(numbers.sort((a, b) => a - b)).toEqual(
      [654_321, 12_345, 31_234, 987_654, 100_000, 2000].sort((a, b) => a - b),
    );
    expect(texts).toEqual(["wants a house", "no crypto"]);
  });

  it("adds the amounts written in memory notes (>= 100 only, dates skipped)", () => {
    const parsed = askRequestSchema.parse({
      ...VALID,
      profile: { memory: ["我有 2,000,000 存款", "每月 30 號領薪", "2026-10-14 開始存 1.5萬"] },
    });
    const { numbers } = privateValues(parsed.profile);
    expect(numbers.sort((a, b) => a - b)).toEqual([15_000, 2_000_000]);
  });

  it("does not read a ticker code in a note as an amount", () => {
    const parsed = askRequestSchema.parse({
      ...VALID,
      profile: { memory: ["想買00878和0050", "預算 1500"] },
    });
    // 00878 and 0050 are codes; 1500 is a plain number and stays private.
    expect(privateValues(parsed.profile).numbers).toEqual([1500]);
  });

  it("is empty for the default profile", () => {
    const parsed = askRequestSchema.parse(VALID);
    expect(privateValues(parsed.profile)).toEqual({ numbers: [], texts: [] });
  });
});
