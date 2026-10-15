import { afterEach, describe, expect, it, vi } from "vitest";
import { planRequestSchema, MAX_AMOUNT as SCHEMA_MAX_AMOUNT } from "@/planner/schema";
import {
  DRAFT_KEY,
  EMPTY_DRAFT,
  MAX_AMOUNT,
  type PlanDraft,
  parseAmount,
  parseDraft,
  readDraft,
  serializeDraft,
  toRequest,
  validateDraft,
  writeDraft,
} from "@/ui/plan/draft";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const FULL: PlanDraft = {
  answers: {
    age: "age-40-49",
    horizon: "horizon-5-10y",
    income: "income-stable",
    reserve: "reserve-3-6m",
    loss: "loss-hold",
  },
  amounts: {
    lump: "600,000",
    monthly: "15000",
    monthlyExpenses: "30,000",
    existingReserve: "90000",
  },
};

describe("parseDraft", () => {
  it("returns the empty draft for null and for invalid JSON", () => {
    expect(parseDraft(null)).toEqual(EMPTY_DRAFT);
    expect(parseDraft("{not json")).toEqual(EMPTY_DRAFT);
    expect(parseDraft("[1,2]")).toEqual(EMPTY_DRAFT);
    expect(parseDraft('"text"')).toEqual(EMPTY_DRAFT);
  });

  it("drops only an option id that the question does not list", () => {
    const raw = JSON.stringify({ ...FULL, answers: { ...FULL.answers, age: "age-99" } });
    const { age, ...rest } = FULL.answers;
    expect(age).toBe("age-40-49");
    expect(parseDraft(raw)).toEqual({ answers: rest, amounts: FULL.amounts });
  });

  it("ignores unknown question ids", () => {
    const raw = JSON.stringify({ ...FULL, answers: { ...FULL.answers, extra: "x" } });
    expect(parseDraft(raw)).toEqual(FULL);
  });

  it("drops a non-string amount and keeps the others", () => {
    const raw = JSON.stringify({ ...FULL, amounts: { ...FULL.amounts, lump: 5 } });
    expect(parseDraft(raw)).toEqual({
      answers: FULL.answers,
      amounts: { ...FULL.amounts, lump: "" },
    });
  });

  it("never hands out the shared EMPTY_DRAFT, so a consumer mutating a draft cannot corrupt it", () => {
    for (const raw of [null, "{not json", "[1]"]) {
      const draft = parseDraft(raw);
      expect(draft).not.toBe(EMPTY_DRAFT);
      expect(draft.answers).not.toBe(EMPTY_DRAFT.answers);
      expect(draft.amounts).not.toBe(EMPTY_DRAFT.amounts);
      draft.answers.age = "age-40-49";
      draft.amounts.lump = "1";
    }
    expect(EMPTY_DRAFT).toEqual({
      answers: {},
      amounts: { lump: "", monthly: "", monthlyExpenses: "", existingReserve: "" },
    });
    expect(readDraft()).toEqual(EMPTY_DRAFT);
  });

  it("is not fooled by prototype keys in the stored answers", () => {
    const raw =
      '{"answers":{"__proto__":{"age":"age-40-49"},"constructor":"age-40-49","age":"constructor"},' +
      '"amounts":{"__proto__":{"lump":"5"},"constructor":"7"}}';
    const draft = parseDraft(raw);
    expect(draft).toEqual(EMPTY_DRAFT);
    expect(Object.keys(draft.answers)).toEqual([]);
    expect(({} as { age?: string }).age).toBeUndefined();
  });

  it("treats a non-object answers or amounts as empty", () => {
    for (const bad of [null, 5, "x", [1, 2], true]) {
      const raw = JSON.stringify({ answers: bad, amounts: bad });
      expect(parseDraft(raw)).toEqual(EMPTY_DRAFT);
    }
    const onlyAmountsBad = JSON.stringify({ answers: FULL.answers, amounts: ["1"] });
    expect(parseDraft(onlyAmountsBad)).toEqual({
      answers: FULL.answers,
      amounts: EMPTY_DRAFT.amounts,
    });
  });

  it("round-trips through serializeDraft", () => {
    expect(parseDraft(serializeDraft(FULL))).toEqual(FULL);
    expect(parseDraft(serializeDraft(EMPTY_DRAFT))).toEqual(EMPTY_DRAFT);
  });
});

describe("readDraft / writeDraft", () => {
  it("persists under DRAFT_KEY and reads it back", () => {
    expect(writeDraft(FULL)).toBe(true);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(serializeDraft(FULL));
    expect(readDraft()).toEqual(FULL);
  });

  it("reads the empty draft and fails to write when localStorage throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readDraft()).toEqual(EMPTY_DRAFT);
    expect(writeDraft(FULL)).toBe(false);
  });

  it("reads the empty draft from corrupt stored text", () => {
    window.localStorage.setItem(DRAFT_KEY, "}{");
    expect(readDraft()).toEqual(EMPTY_DRAFT);
  });
});

describe("parseAmount", () => {
  it("keeps MAX_AMOUNT in step with the request schema", () => {
    expect(MAX_AMOUNT).toBe(SCHEMA_MAX_AMOUNT);
  });

  it.each([
    ["600,000", 600000],
    [" 15000 ", 15000],
    ["007", 7],
    ["０", 0],
    ["６００", 600],
    ["６００，０００", 600000],
    ["1,000,000,000", 1_000_000_000],
  ])("accepts %j", (text, value) => {
    expect(parseAmount(text)).toEqual({ ok: true, value });
  });

  // Pinned decision: group sizes are not checked, so a stray comma never blocks a number.
  it("is lenient about thousands grouping but not about a dot", () => {
    expect(parseAmount("1,00")).toEqual({ ok: true, value: 100 });
    expect(parseAmount("1.000")).toEqual({ ok: false, reason: "not_integer" });
  });

  it.each(["", "   "])("reports %j as empty", (text) => {
    expect(parseAmount(text)).toEqual({ ok: false, reason: "empty" });
  });

  it.each(["12.5", "-5", "1e3", "abc", "1 000", ",", "1,,0"])(
    "rejects %j as not an integer",
    (text) => {
      expect(parseAmount(text)).toEqual({ ok: false, reason: "not_integer" });
    },
  );

  it("rejects values above the maximum", () => {
    expect(parseAmount("1,000,000,001")).toEqual({ ok: false, reason: "too_large" });
    expect(parseAmount("99999999999999999999999")).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("validateDraft", () => {
  it("is complete for five answers and four valid amounts", () => {
    expect(validateDraft(FULL)).toEqual({ complete: true, answersMissing: [], amountErrors: {} });
  });

  it("flags a zero total when lump and monthly are both zero", () => {
    const v = validateDraft({ ...FULL, amounts: { ...FULL.amounts, lump: "0", monthly: "0" } });
    expect(v.complete).toBe(false);
    expect(v.amountErrors).toEqual({ total: "zero" });
  });

  it("accepts zero for one of lump and monthly", () => {
    expect(validateDraft({ ...FULL, amounts: { ...FULL.amounts, lump: "0" } }).complete).toBe(true);
  });

  it("lists a missing answer", () => {
    const { loss, ...answers } = FULL.answers;
    expect(loss).toBe("loss-hold");
    const v = validateDraft({ ...FULL, answers });
    expect(v.complete).toBe(false);
    expect(v.answersMissing).toEqual(["loss"]);
  });

  it("reports per-field amount errors and no total while a field is unparsable", () => {
    const v = validateDraft({
      ...FULL,
      amounts: { lump: "", monthly: "1.5", monthlyExpenses: "2,000,000,000", existingReserve: "0" },
    });
    expect(v.complete).toBe(false);
    expect(v.amountErrors).toEqual({
      lump: "empty",
      monthly: "not_integer",
      monthlyExpenses: "too_large",
    });
  });

  it.each(["", "nope", "age-99", "constructor"])(
    "counts the answer id %j as missing when the question does not list it",
    (id) => {
      const v = validateDraft({ ...FULL, answers: { ...FULL.answers, age: id } });
      expect(v.complete).toBe(false);
      expect(v.answersMissing).toEqual(["age"]);
    },
  );

  it("rejects an option id that belongs to a different question", () => {
    const v = validateDraft({ ...FULL, answers: { ...FULL.answers, age: "loss-hold" } });
    expect(v.answersMissing).toEqual(["age"]);
  });

  it("lists every missing answer for the empty draft", () => {
    const v = validateDraft(EMPTY_DRAFT);
    expect(v.answersMissing).toEqual(["age", "horizon", "income", "reserve", "loss"]);
    expect(v.amountErrors).toMatchObject({ lump: "empty", monthly: "empty" });
  });
});

describe("toRequest", () => {
  it("returns the exact request for the level-3 sample", () => {
    const request = toRequest(FULL);
    expect(request).toEqual({
      answers: {
        age: "age-40-49",
        horizon: "horizon-5-10y",
        income: "income-stable",
        reserve: "reserve-3-6m",
        loss: "loss-hold",
      },
      lump: 600000,
      monthly: 15000,
      monthlyExpenses: 30000,
      existingReserve: 90000,
    });
    expect(planRequestSchema.safeParse(request).success).toBe(true);
  });

  it("returns null for an answer id the schema would reject", () => {
    expect(toRequest({ ...FULL, answers: { ...FULL.answers, loss: "nope" } })).toBeNull();
    expect(toRequest({ ...FULL, answers: { ...FULL.answers, loss: "" } })).toBeNull();
  });

  it("returns null while the draft is incomplete", () => {
    expect(toRequest(EMPTY_DRAFT)).toBeNull();
    expect(
      toRequest({ ...FULL, amounts: { ...FULL.amounts, lump: "0", monthly: "0" } }),
    ).toBeNull();
  });
});
