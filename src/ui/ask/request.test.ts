import { afterEach, describe, expect, it } from "vitest";
import { askRequestSchema, MAX_ASK_BODY_BYTES } from "@/ask/schema";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import { ASK_LIMITS } from "@/ui/ask/limits";
import { buildAskBody, currentPlanRequest, describeOutgoing, trimMessages } from "@/ui/ask/request";
import type { ChatMessage, Holding } from "@/ui/ask/stores";
import { writeItem } from "@/ui/device/storage";
import { DRAFT_KEY, type PlanDraft, serializeDraft } from "@/ui/plan/draft";

afterEach(() => window.localStorage.clear());

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const user = (content: string): ChatMessage => ({ role: "user", content });
const bot = (content: string): ChatMessage => ({ role: "assistant", content });
const opts = { maxMessages: ASK_LIMITS.maxMessages, maxBytes: ASK_LIMITS.clientBodyBudget };

/** Alternating conversation ending with a user message. */
const conversation = (count: number, make: (i: number) => string): ChatMessage[] =>
  Array.from({ length: count }, (_, i) => (i % 2 === (count - 1) % 2 ? user : bot)(make(i)));

const FULL_DRAFT: PlanDraft = {
  answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[0]?.id ?? ""])),
  amounts: {
    lump: "600,000",
    monthly: "15000",
    monthlyExpenses: "30,000",
    existingReserve: "90000",
  },
};
const PLAN = {
  answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[0]?.id])),
  lump: 600000,
  monthly: 15000,
  monthlyExpenses: 30000,
  existingReserve: 90000,
} as NonNullable<ReturnType<typeof currentPlanRequest>>;

describe("trimMessages", () => {
  it("keeps the newest 20 of 25 messages", () => {
    const messages = conversation(25, (i) => `m${i}`);
    const trimmed = trimMessages(messages, opts);
    expect(trimmed).toHaveLength(20);
    expect(trimmed[0]?.content).toBe("m5");
    expect(trimmed.at(-1)?.content).toBe("m24");
  });

  it("leaves a short conversation untouched", () => {
    const messages = conversation(3, (i) => `m${i}`);
    expect(trimMessages(messages, opts)).toEqual(messages);
  });

  it("measures UTF-8 bytes, not characters, dropping oldest first", () => {
    // 100 KB of CJK is ~33k characters: under any character budget, far over the byte budget.
    const messages = conversation(20, () => "投".repeat(1700));
    expect(JSON.stringify(messages).length).toBeLessThan(ASK_LIMITS.clientBodyBudget);
    expect(bytes(messages)).toBeGreaterThan(100_000);
    const trimmed = trimMessages(messages, opts);
    expect(bytes(trimmed)).toBeLessThanOrEqual(ASK_LIMITS.clientBodyBudget);
    expect(trimmed.length).toBeLessThan(20);
    expect(trimmed.at(-1)).toEqual(messages.at(-1));
    // What is kept is a suffix of the original.
    expect(trimmed).toEqual(messages.slice(messages.length - trimmed.length));
  });

  it("truncates a single 5000-character message to 4000", () => {
    const [only] = trimMessages([user("a".repeat(5000))], opts);
    expect(only?.content).toHaveLength(4000);
  });

  it("always keeps the last user message even when it alone exceeds the budget", () => {
    const messages = [bot("old"), user("投".repeat(4000))];
    const trimmed = trimMessages(messages, { maxMessages: 20, maxBytes: 100 });
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]?.role).toBe("user");
  });

  it("drops trailing assistant messages so the request ends with the user's question", () => {
    const trimmed = trimMessages([user("q1"), bot("a1"), user("q2"), bot("partial")], opts);
    expect(trimmed.at(-1)).toEqual(user("q2"));
  });

  it("drops empty messages the server would reject", () => {
    expect(trimMessages([user("q1"), bot(""), user("q2")], opts)).toEqual([user("q1"), user("q2")]);
  });

  it("returns [] when there is no user message", () => {
    expect(trimMessages([bot("x")], opts)).toEqual([]);
    expect(trimMessages([], opts)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const messages = conversation(25, (i) => `m${i}`);
    const copy = structuredClone(messages);
    trimMessages(messages, opts);
    expect(messages).toEqual(copy);
  });
});

describe("buildAskBody", () => {
  const base = {
    messages: [user("hi")],
    lens: "beginner" as const,
    holdings: [],
    memory: [],
    plan: null,
  };

  it("omits profile when there is nothing to send", () => {
    const body = buildAskBody(base);
    expect(body).toEqual({ lens: "beginner", messages: [user("hi")] });
    expect("profile" in body).toBe(false);
  });

  it("includes plan only when given", () => {
    const without = buildAskBody({ ...base, memory: ["m"] });
    expect(without.profile).toEqual({ holdings: [], memory: ["m"] });
    expect(without.profile && "plan" in without.profile).toBe(false);
    const withPlan = buildAskBody({ ...base, plan: PLAN });
    expect(withPlan.profile).toEqual({ plan: PLAN, holdings: [], memory: [] });
  });

  it("sends the lens through", () => {
    expect(buildAskBody({ ...base, lens: "pro" }).lens).toBe("pro");
  });

  it("never includes keys beyond the schema", () => {
    const holdings = [{ symbol: "0050", amount: 5, secret: "x" }] as unknown as Holding[];
    const messages = [{ role: "user", content: "hi", notices: ["x"] }] as unknown as ChatMessage[];
    const body = buildAskBody({ ...base, messages, holdings });
    expect(Object.keys(body).sort()).toEqual(["lens", "messages", "profile"]);
    expect(body.messages).toEqual([user("hi")]);
    expect(body.profile?.holdings).toEqual([{ symbol: "0050", amount: 5 }]);
  });

  it("caps holdings and memory at the limits", () => {
    const holdings = Array.from({ length: 40 }, (_, i) => ({ symbol: `S${i + 10}` }));
    const memory = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const body = buildAskBody({ ...base, holdings, memory });
    expect(body.profile?.holdings).toHaveLength(30);
    expect(body.profile?.memory).toHaveLength(20);
  });

  it("fits the budget with a maximal profile and a long CJK conversation", () => {
    const body = buildAskBody({
      messages: conversation(25, () => "投".repeat(4000)),
      lens: "pro",
      holdings: Array.from({ length: 30 }, (_, i) => ({
        symbol: `ABCDEFGH${i % 10}${i % 7}`,
        amount: 1_000_000_000,
        quantity: 1_000_000_000,
      })),
      memory: Array.from({ length: 20 }, () => "記".repeat(200)),
      plan: PLAN,
    });
    expect(bytes(body)).toBeLessThanOrEqual(ASK_LIMITS.clientBodyBudget);
    expect(body.messages.at(-1)?.role).toBe("user");
  });

  it("round-trips through the server schema for a maximal body", () => {
    const body = buildAskBody({
      messages: conversation(25, () => "投".repeat(4000)),
      lens: "beginner",
      holdings: Array.from({ length: 30 }, (_, i) => ({
        symbol: `AB${i + 10}`,
        amount: 1_000_000_000,
        quantity: 0,
      })),
      memory: Array.from(
        { length: 20 },
        (_, i) => `${String.fromCharCode(65 + i)}${"記".repeat(199)}`,
      ),
      plan: PLAN,
    });
    const parsed = askRequestSchema.safeParse(body);
    expect(parsed.error?.issues).toBeUndefined();
    expect(bytes(body)).toBeLessThanOrEqual(MAX_ASK_BODY_BYTES);
  });

  it("round-trips a minimal body", () => {
    expect(askRequestSchema.safeParse(buildAskBody(base)).success).toBe(true);
  });
});

describe("describeOutgoing", () => {
  it("counts what would be sent", () => {
    expect(
      describeOutgoing({
        messages: [user("q")],
        lens: "pro",
        holdings: [{ symbol: "AB" }, { symbol: "CD" }],
        memory: ["a"],
        plan: PLAN,
      }),
    ).toEqual({ plan: true, holdings: 2, memory: 1 });
    expect(
      describeOutgoing({ messages: [], lens: "pro", holdings: [], memory: [], plan: null }),
    ).toEqual({ plan: false, holdings: 0, memory: 0 });
  });
});

describe("currentPlanRequest", () => {
  it("is null when the opt-in is off, even with a complete draft", () => {
    writeItem(DRAFT_KEY, serializeDraft(FULL_DRAFT));
    expect(currentPlanRequest(false)).toBeNull();
  });

  it("is null for a missing or incomplete draft", () => {
    expect(currentPlanRequest(true)).toBeNull();
    const incomplete = { ...FULL_DRAFT, answers: { age: FULL_DRAFT.answers.age } };
    writeItem(DRAFT_KEY, serializeDraft(incomplete));
    expect(currentPlanRequest(true)).toBeNull();
  });

  it("is the request for a complete draft with the opt-in on", () => {
    writeItem(DRAFT_KEY, serializeDraft(FULL_DRAFT));
    expect(currentPlanRequest(true)).toEqual(PLAN);
  });
});
