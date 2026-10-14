import { describe, expect, it } from "vitest";
import { type Answers, QUESTIONS, scoreProfile } from "./questionnaire";

const SIGNED_OFF = {
  age: [
    ["age-60-plus", "60 歲以上", 1],
    ["age-50-59", "50–59", 2],
    ["age-40-49", "40–49", 3],
    ["age-30-39", "30–39", 4],
    ["age-under-30", "30 歲以下", 5],
  ],
  horizon: [
    ["horizon-lt-1y", "少於 1 年", 1],
    ["horizon-1-3y", "1–3 年", 2],
    ["horizon-3-5y", "3–5 年", 3],
    ["horizon-5-10y", "5–10 年", 4],
    ["horizon-10y-plus", "10 年以上", 5],
  ],
  income: [
    ["income-unstable", "不穩定或沒有收入", 1],
    ["income-fluctuating", "有起伏", 3],
    ["income-stable", "穩定", 5],
  ],
  reserve: [
    ["reserve-lt-3m", "少於 3 個月", 1],
    ["reserve-3-6m", "3–6 個月", 3],
    ["reserve-6m-plus", "6 個月以上", 5],
  ],
  loss: [
    ["loss-sell-all", "馬上全部賣掉", 1],
    ["loss-sell-some", "賣掉一部分", 2],
    ["loss-hold", "不動", 3],
    ["loss-add-some", "再加碼一點", 4],
    ["loss-add-lots", "大幅加碼", 5],
  ],
} as const;

const BEST: Answers = {
  age: "age-under-30",
  horizon: "horizon-10y-plus",
  income: "income-stable",
  reserve: "reserve-6m-plus",
  loss: "loss-add-lots",
};

describe("QUESTIONS", () => {
  it("has the five signed-off questions in order", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(["age", "horizon", "income", "reserve", "loss"]);
  });

  for (const [questionId, expected] of Object.entries(SIGNED_OFF)) {
    it(`${questionId} options match the spec`, () => {
      const question = QUESTIONS.find((q) => q.id === questionId);
      expect(question?.options.map((o) => [o.id, o.label, o.score])).toEqual(expected);
    });
  }
});

describe("scoreProfile", () => {
  it("all best answers give level 5", () => {
    expect(scoreProfile(BEST)).toEqual({
      capacity: 5,
      willingness: 5,
      level: 5,
      cappedByHorizon: false,
      reserveFirst: false,
    });
  });

  it("capacity 5 with a sell-all loss answer gives level 1", () => {
    const profile = scoreProfile({ ...BEST, loss: "loss-sell-all" });
    expect(profile.capacity).toBe(5);
    expect(profile.willingness).toBe(1);
    expect(profile.level).toBe(1);
  });

  it("capacity 2 with willingness 5 gives level 2", () => {
    // scores 2,2,1,3 = mean 2
    const profile = scoreProfile({
      age: "age-50-59",
      horizon: "horizon-1-3y",
      income: "income-unstable",
      reserve: "reserve-3-6m",
      loss: "loss-add-lots",
    });
    expect(profile.capacity).toBe(2);
    expect(profile.level).toBe(2);
  });

  it("horizon under 1 year caps at level 1", () => {
    const profile = scoreProfile({ ...BEST, horizon: "horizon-lt-1y" });
    expect(profile.level).toBe(1);
    expect(profile.cappedByHorizon).toBe(true);
  });

  it("horizon 1-3 years caps at level 2", () => {
    const profile = scoreProfile({ ...BEST, horizon: "horizon-1-3y" });
    expect(profile.level).toBe(2);
    expect(profile.cappedByHorizon).toBe(true);
  });

  it("does not flag the cap when the level is already below it", () => {
    const profile = scoreProfile({
      age: "age-60-plus",
      horizon: "horizon-lt-1y",
      income: "income-unstable",
      reserve: "reserve-lt-3m",
      loss: "loss-sell-all",
    });
    expect(profile.level).toBe(1);
    expect(profile.cappedByHorizon).toBe(false);
  });

  it("flags reserveFirst when the reserve answer scores 1", () => {
    expect(scoreProfile({ ...BEST, reserve: "reserve-lt-3m" }).reserveFirst).toBe(true);
    expect(scoreProfile({ ...BEST, reserve: "reserve-3-6m" }).reserveFirst).toBe(false);
  });

  it("rounds the capacity mean half up", () => {
    // 5,5,1,1 = 12/4 = 3
    expect(
      scoreProfile({
        age: "age-under-30",
        horizon: "horizon-10y-plus",
        income: "income-unstable",
        reserve: "reserve-lt-3m",
        loss: "loss-add-lots",
      }).capacity,
    ).toBe(3);
    // 5,4,1,1 = 11/4 = 2.75 -> 3
    expect(
      scoreProfile({
        age: "age-under-30",
        horizon: "horizon-5-10y",
        income: "income-unstable",
        reserve: "reserve-lt-3m",
        loss: "loss-add-lots",
      }).capacity,
    ).toBe(3);
    // 4,4,1,1 = 10/4 = 2.5 -> 3
    expect(
      scoreProfile({
        age: "age-30-39",
        horizon: "horizon-5-10y",
        income: "income-unstable",
        reserve: "reserve-lt-3m",
        loss: "loss-add-lots",
      }).capacity,
    ).toBe(3);
  });

  it("throws on an unknown option id", () => {
    expect(() => scoreProfile({ ...BEST, age: "age-200" })).toThrow(/age/);
  });
});
