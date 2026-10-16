// Request and response contract of POST /api/plan.
import { z } from "zod";
import { QUESTIONS } from "./rules/questionnaire";

export const MAX_AMOUNT = 1_000_000_000;

const amount = z.number().int().min(0).max(MAX_AMOUNT);

type Question = (typeof QUESTIONS)[number];
const optionIds = <Q extends Question>(question: Q) =>
  z.enum(question.options.map((o) => o.id) as [Q["options"][number]["id"]]);

const [age, horizon, income, reserve, loss] = QUESTIONS;

export const planRequestSchema = z
  .object({
    answers: z.object({
      age: optionIds(age),
      horizon: optionIds(horizon),
      income: optionIds(income),
      reserve: optionIds(reserve),
      loss: optionIds(loss),
    }),
    lump: amount,
    monthly: amount,
    monthlyExpenses: amount,
    existingReserve: amount,
  })
  .refine((r) => r.lump + r.monthly > 0, { message: "lump or monthly must be positive" });

export type PlanRequest = z.infer<typeof planRequestSchema>;

const score = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const profileSchema = z.object({
  capacity: score,
  willingness: score,
  level: score,
  cappedByHorizon: z.boolean(),
  reserveFirst: z.boolean(),
});

const money = z.number().int().min(0);
const slices = z.object({
  core: money,
  bond: money,
  dividend: money,
  satellite: money,
  cash: money,
});

/** Integer percents of the investable money per slice. */
const percent = z.number().int().min(0).max(100);
const weights = z.object({
  core: percent,
  bond: percent,
  dividend: percent,
  satellite: percent,
  cash: percent,
});

const amountPlanSchema = z.object({
  reserveTarget: money,
  reserveGap: money,
  reserveOnly: z.boolean(),
  investable: money,
  slices,
  /**
   * The post-fallback integer percents `slices` were split by (sum 100): the allocation table
   * row, with a slice that has no eligible ETF moved to cash. Also tells a saver with no lump
   * (`investable` 0) how their monthly amount is split.
   */
  weights,
  /** The rhythm rule's raw tranche months; `rhythm.trancheMonths` is what the plan scenario used. */
  trancheMonths: z.number().int().min(1),
  monthsToFillReserve: z.number().int().min(0).nullable(),
});

const isoDate = z.iso.date();

const backtestSchema = z.object({
  from: isoDate,
  to: isoDate,
  invested: money,
  finalValue: money,
  /** Money-weighted (含投入時點); null when the window is too short to solve. */
  xirr: z.number().nullable(),
  /** Only for a single day-1 contribution. */
  cagr: z.number().nullable(),
  maxDrawdown: z.number(),
  volatility: z.number(),
  worstYear: z.number().nullable(),
  /**
   * Month-end series: the first point (`from`), each month's last trading day, and the last
   * point (`to`, whose value is `finalValue`). The metrics above use the daily data.
   */
  valueSeries: z.array(z.object({ date: isoDate, value: money, invested: money })),
});

export type PlanBacktest = z.infer<typeof backtestSchema>;

const scenarios = z.object({ lump: backtestSchema, dca: backtestSchema, plan: backtestSchema });

const common = {
  profile: profileSchema,
  amounts: amountPlanSchema,
  warnings: z.array(z.string()),
  assumptions: z.array(z.string()),
};

export const planResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plan"),
    ...common,
    instruments: z.array(
      z.object({
        category: z.enum(["core", "bond", "dividend"]),
        symbol: z.string(),
        name: z.string(),
        alternate: z.string().nullable(),
      }),
    ),
    /**
     * Tranche months actually used by the `plan` scenario (1 when the lump is too small to split);
     * `amounts.trancheMonths` is the raw rule.
     */
    rhythm: z.object({ trancheMonths: z.number().int().min(1) }),
    window: z.object({
      from: isoDate,
      to: isoDate,
      years: z.number(),
      symbols: z.array(z.string()),
    }),
    scenarios,
    equityOnly: scenarios.extend({ from: isoDate, years: z.number() }).nullable(),
  }),
  z.object({ kind: z.literal("reserve_only"), ...common }),
  z.object({ kind: z.literal("insufficient_history"), ...common }),
]);

export type PlanResponse = z.infer<typeof planResponseSchema>;
