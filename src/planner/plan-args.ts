// Command-line arguments of `bun run plan:dev`: a risk level plus amounts become a PlanRequest.
import { parseArgs } from "node:util";
import { QUESTIONS, scoreProfile } from "./rules/questionnaire";
import { type PlanRequest, planRequestSchema } from "./schema";

export type PlanArgs = { mode: "discover" } | { mode: "plan"; request: PlanRequest; level: number };

export type ParsedPlanArgs = { ok: true; value: PlanArgs } | { ok: false; message: string };

const INCOMES = {
  stable: "income-stable",
  fluctuating: "income-fluctuating",
  unstable: "income-unstable",
};

const AMOUNT_FLAGS = ["lump", "monthly", "expenses", "reserve"] as const;

const fail = (message: string): ParsedPlanArgs => ({ ok: false, message });

/** The id of the option scoring `score` for a question (the questionnaire is plain data). */
function optionWithScore(questionId: (typeof QUESTIONS)[number]["id"], score: number): string {
  const option = QUESTIONS.find((q) => q.id === questionId)?.options.find((o) => o.score === score);
  if (!option) throw new Error(`no ${questionId} option scores ${score}`);
  return option.id;
}

/**
 * `--discover`, or `--level 1..5 --lump N --monthly N --expenses N --reserve N --income
 * stable|fluctuating|unstable`. The level is reached through the questionnaire itself (best
 * age, horizon and reserve answers, the loss answer set to the level) so the script runs the
 * same scoring as the route; a level the chosen income cannot reach is rejected.
 */
export function parsePlanArgs(argv: string[]): ParsedPlanArgs {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        discover: { type: "boolean" },
        level: { type: "string" },
        income: { type: "string" },
        lump: { type: "string" },
        monthly: { type: "string" },
        expenses: { type: "string" },
        reserve: { type: "string" },
      },
    }));
  } catch (error) {
    return fail(
      error instanceof Error ? (error.message.split("\n")[0] as string) : "bad arguments",
    );
  }
  if (values.discover === true) return { ok: true, value: { mode: "discover" } };

  const amounts: Record<string, number> = {};
  for (const flag of AMOUNT_FLAGS) {
    const raw = values[flag];
    if (typeof raw !== "string") return fail(`missing --${flag}`);
    if (!/^\d+$/.test(raw))
      return fail(`--${flag} must be a non-negative whole number, got "${raw}"`);
    amounts[flag] = Number(raw);
  }
  const levelRaw = values.level;
  if (typeof levelRaw !== "string") return fail("missing --level");
  const level = Number(levelRaw);
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return fail(`--level must be 1 to 5, got "${levelRaw}"`);
  }
  const incomeRaw = values.income;
  if (typeof incomeRaw !== "string") return fail("missing --income");
  const income = INCOMES[incomeRaw as keyof typeof INCOMES];
  if (!income) return fail(`--income must be stable, fluctuating or unstable, got "${incomeRaw}"`);

  const request = planRequestSchema.safeParse({
    answers: {
      age: optionWithScore("age", 5),
      horizon: optionWithScore("horizon", 5),
      income,
      reserve: optionWithScore("reserve", 5),
      loss: optionWithScore("loss", level),
    },
    lump: amounts.lump,
    monthly: amounts.monthly,
    monthlyExpenses: amounts.expenses,
    existingReserve: amounts.reserve,
  });
  if (!request.success) return fail("amounts: lump or monthly must be positive and under 1e9");
  const reached = scoreProfile(request.data.answers).level;
  if (reached !== level) {
    return fail(
      `level ${level} is not reachable with --income ${incomeRaw} (highest is ${reached})`,
    );
  }
  return { ok: true, value: { mode: "plan", request: request.data, level } };
}
