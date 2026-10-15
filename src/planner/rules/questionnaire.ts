// Signed-off risk questionnaire (spec 「風險問卷與計分」). Plain data plus one pure scorer.

export type RiskLevel = 1 | 2 | 3 | 4 | 5;

export const QUESTIONS = [
  {
    id: "age",
    options: [
      { id: "age-60-plus", label: "60 歲以上", score: 1 },
      { id: "age-50-59", label: "50–59", score: 2 },
      { id: "age-40-49", label: "40–49", score: 3 },
      { id: "age-30-39", label: "30–39", score: 4 },
      { id: "age-under-30", label: "30 歲以下", score: 5 },
    ],
  },
  {
    id: "horizon",
    options: [
      { id: "horizon-lt-1y", label: "少於 1 年", score: 1 },
      { id: "horizon-1-3y", label: "1–3 年", score: 2 },
      { id: "horizon-3-5y", label: "3–5 年", score: 3 },
      { id: "horizon-5-10y", label: "5–10 年", score: 4 },
      { id: "horizon-10y-plus", label: "10 年以上", score: 5 },
    ],
  },
  {
    id: "income",
    options: [
      { id: "income-unstable", label: "不穩定或沒有收入", score: 1 },
      { id: "income-fluctuating", label: "有起伏", score: 3 },
      { id: "income-stable", label: "穩定", score: 5 },
    ],
  },
  {
    id: "reserve",
    options: [
      { id: "reserve-lt-3m", label: "少於 3 個月", score: 1 },
      { id: "reserve-3-6m", label: "3–6 個月", score: 3 },
      { id: "reserve-6m-plus", label: "6 個月以上", score: 5 },
    ],
  },
  {
    id: "loss",
    options: [
      { id: "loss-sell-all", label: "馬上全部賣掉", score: 1 },
      { id: "loss-sell-some", label: "賣掉一部分", score: 2 },
      { id: "loss-hold", label: "不動", score: 3 },
      { id: "loss-add-some", label: "再加碼一點", score: 4 },
      { id: "loss-add-lots", label: "大幅加碼", score: 5 },
    ],
  },
] as const satisfies readonly {
  id: string;
  options: readonly { id: string; label: string; score: number }[];
}[];

type QuestionId = (typeof QUESTIONS)[number]["id"];

/** Selected option id per question. */
export type Answers = Record<QuestionId, string>;

type Score = 1 | 2 | 3 | 4 | 5;

export type Profile = {
  capacity: Score;
  willingness: Score;
  level: RiskLevel;
  cappedByHorizon: boolean;
  reserveFirst: boolean;
};

/** The score of `optionId` for `questionId`; throws on an id the question does not list. */
export function scoreOf(questionId: QuestionId, optionId: string): Score {
  const question = QUESTIONS.find((q) => q.id === questionId);
  const option = question?.options.find((o) => o.id === optionId);
  if (!option) {
    throw new Error(`Unknown option "${optionId}" for question "${questionId}"`);
  }
  return option.score as Score;
}

export function scoreProfile(answers: Answers): Profile {
  const age = scoreOf("age", answers.age);
  const horizon = scoreOf("horizon", answers.horizon);
  const income = scoreOf("income", answers.income);
  const reserve = scoreOf("reserve", answers.reserve);
  const willingness = scoreOf("loss", answers.loss);

  // Scores are integers, so floor(sum / 4 + 0.5) is round-half-up without float noise.
  const capacity = Math.floor((age + horizon + income + reserve + 2) / 4) as Score;
  const base = Math.min(capacity, willingness);
  // A horizon under 1 year allows level 1 at most; 1–3 years allows level 2 at most.
  const horizonCap = horizon === 1 ? 1 : horizon === 2 ? 2 : 5;
  const level = Math.min(base, horizonCap) as RiskLevel;

  return {
    capacity,
    willingness,
    level,
    cappedByHorizon: level < base,
    reserveFirst: reserve === 1,
  };
}
