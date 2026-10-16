// Pure shaping of a /api/plan response into what the 規劃 result screen shows. Every sentence
// comes from copy.ts; the numbers come only from the response (and the user's own monthly amount).
import type { Lens } from "@/insight/lens";
import { splitByLargestRemainder } from "@/planner/amounts";
import type { PlanJson } from "@/ui/data/api";
import { formatRatio } from "@/ui/format";
import {
  ALTERNATE_PREFIX,
  CASH_DETAIL,
  NOTICE_COPY,
  RHYTHM_COPY,
  RHYTHM_ONCE_WHEN,
  rhythmFrom,
  rhythmRange,
  SATELLITE_DETAIL,
  type ScenarioKey,
  SLICE_LABELS,
  type SliceKey,
} from "@/ui/plan/copy";

export type PlanOk = Extract<PlanJson, { kind: "plan" }>;

export type SliceRow = {
  key: SliceKey;
  label: string;
  amount: number;
  /** The response's integer-percent weight for this slice (after any fall-back to cash). */
  percent: number;
  detail: string | null;
};

const SLICE_ORDER: readonly SliceKey[] = ["core", "bond", "dividend", "satellite", "cash"];

/** Only the three fund slices have an instrument; the other two carry a fixed sentence. */
function sliceDetail(plan: PlanJson, key: SliceKey): string | null {
  if (key === "satellite") return SATELLITE_DETAIL;
  if (key === "cash") return CASH_DETAIL;
  if (plan.kind !== "plan") return null;
  const instrument = plan.instruments.find((i) => i.category === key);
  if (!instrument) return null;
  const name = `${instrument.name}（${instrument.symbol}）`;
  return instrument.alternate === null ? name : `${name}${ALTERNATE_PREFIX}${instrument.alternate}`;
}

/**
 * A plan with nothing to invest now (the reserve takes the whole lump, or there is no lump) but a
 * monthly amount: the allocation then describes how each month's money is split.
 */
export function monthlyOnly(plan: PlanJson, monthly: number): boolean {
  return plan.kind !== "reserve_only" && plan.amounts.investable === 0 && monthly > 0;
}

/**
 * The slices that carry weight, in table order; none for a reserve-only plan. Percents are the
 * response's weights. Amounts are the slices of `amounts.investable`, or, when nothing is invested
 * now (`monthlyOnly`), the split of one month's `monthly` amount by the same weights.
 */
export function sliceRows(plan: PlanJson, monthly = 0): SliceRow[] {
  if (plan.kind === "reserve_only") return [];
  const { slices, weights } = plan.amounts;
  const amounts = monthlyOnly(plan, monthly) ? splitByLargestRemainder(monthly, weights) : slices;
  return SLICE_ORDER.filter((key) => weights[key] > 0).map((key) => ({
    key,
    label: SLICE_LABELS[key],
    amount: amounts[key],
    percent: weights[key],
    detail: sliceDetail(plan, key),
  }));
}

/**
 * How the money goes in. The plan scenario's own tranche months are used when the response has
 * one; a response without scenarios falls back to the rule's raw months. Each month gets
 * `floor(investable / months)` and month 1 also the remainder, as the engine's schedule does.
 * Nothing for reserve-only.
 */
export function rhythmLines(
  plan: PlanJson,
  monthly: number,
  lens: Lens = "beginner",
): { when: string; what: string }[] {
  if (plan.kind === "reserve_only") return [];
  const copy = RHYTHM_COPY[lens];
  const { investable } = plan.amounts;
  if (monthlyOnly(plan, monthly)) {
    return [{ when: rhythmFrom(1), what: copy.monthlyOnly(monthly) }];
  }
  const months = plan.kind === "plan" ? plan.rhythm.trancheMonths : plan.amounts.trancheMonths;
  if (months === 1) {
    return [
      {
        when: monthly > 0 ? RHYTHM_ONCE_WHEN.withMonthly : RHYTHM_ONCE_WHEN.lumpOnly,
        what: copy.once({ lump: investable, monthly }),
      },
    ];
  }
  // Like the engine: equal shares rounded down, the remainder joins month 1.
  const part = Math.floor(investable / months);
  const extra = investable - part * months;
  const lines = [
    { when: rhythmRange(months), what: copy.tranche({ part, extra, monthly, months }) },
  ];
  if (monthly > 0) lines.push({ when: rhythmFrom(months + 1), what: copy.ongoing(monthly) });
  return lines;
}

/**
 * The emergency reserve against this request. `lump` is the request's lump sum (the response
 * does not echo it): it goes to the reserve first, so `remainingGap` is what the monthly amount
 * still has to fill, and `monthsToFill` (from the response) counts months for that remainder.
 */
export function reserveView(
  plan: PlanJson,
  lump: number,
): {
  target: number;
  gap: number;
  have: number;
  deposit: number;
  remainingGap: number;
  funded: boolean;
  monthsToFill: number | null;
} {
  const { reserveTarget, reserveGap, monthsToFillReserve } = plan.amounts;
  const remainingGap = Math.max(0, reserveGap - lump);
  return {
    target: reserveTarget,
    gap: reserveGap,
    have: reserveTarget - reserveGap,
    deposit: Math.min(lump, reserveGap),
    remainingGap,
    funded: remainingGap === 0,
    monthsToFill: monthsToFillReserve,
  };
}

export type Notice = { id: string; tone: "info" | "warn"; title: string; body: string };

/**
 * The level-1 note: only when the bond slice holds money and a bond ETF stands behind it (a bond
 * slice held as cash has no bond ETF to describe). The drawdown is the whole mix's.
 */
function level1Note(plan: PlanJson, lens: Lens): Notice | null {
  if (plan.kind !== "plan" || plan.profile.level !== 1) return null;
  const bond = sliceRows(plan).find((row) => row.key === "bond");
  const instrument = plan.instruments.find((i) => i.category === "bond");
  if (!bond || !instrument) return null;
  const { maxDrawdown } = plan.scenarios.plan;
  return {
    id: "level1-bond",
    tone: "info",
    title: NOTICE_COPY.level1.title,
    body: NOTICE_COPY.level1.body(lens, {
      percent: bond.percent,
      name: instrument.name,
      symbol: instrument.symbol,
      drop: formatRatio(Math.abs(maxDrawdown)).replace(/^\+/, ""),
      signed: formatRatio(maxDrawdown),
    }),
  };
}

/** `lump` is the request's lump sum (see `reserveView`); `lens` words the drawdown. */
export function notices(plan: PlanJson, lump: number, lens: Lens = "beginner"): Notice[] {
  const list: Notice[] = [];
  if (plan.kind === "reserve_only") {
    const view = reserveView(plan, lump);
    list.push({
      id: "reserve-only",
      tone: "info",
      title: NOTICE_COPY.reserveOnly.title,
      body: NOTICE_COPY.reserveOnly.body({
        target: view.target,
        have: view.have,
        deposit: view.deposit,
        remaining: view.remainingGap,
        months: view.remainingGap === 0 ? 0 : view.monthsToFill,
      }),
    });
  }
  plan.warnings.forEach((warning, i) => {
    list.push({
      id: `warning-${i}`,
      tone: "warn",
      title: NOTICE_COPY.warningTitle,
      body: warning,
    });
  });
  if (plan.profile.cappedByHorizon) {
    list.push({ id: "capped-by-horizon", tone: "info", ...NOTICE_COPY.cappedByHorizon });
  }
  if (plan.kind === "insufficient_history") {
    list.push({ id: "insufficient-history", tone: "warn", ...NOTICE_COPY.insufficientHistory });
  }
  const level1 = level1Note(plan, lens);
  if (level1) list.push(level1);
  return list;
}

export type ScenarioRow = {
  key: ScenarioKey;
  invested: number;
  finalValue: number;
  xirr: number | null;
};

export type ChartPoint = {
  date: string;
  lump: number;
  dca: number;
  plan: number;
  invested: number;
};

export type HistoryView = {
  window: { from: string; to: string; years: number };
  rows: ScenarioRow[];
  /** From the plan scenario. */
  metrics: { maxDrawdown: number; worstYear: number | null; volatility: number };
  series: ChartPoint[];
};

const SCENARIO_ORDER: readonly ScenarioKey[] = ["lump", "dca", "plan"];

/** The three month-end series share their dates; a response where they do not is malformed. */
function chartSeries(scenarios: PlanOk["scenarios"]): ChartPoint[] {
  const { lump, dca, plan } = scenarios;
  const length = plan.valueSeries.length;
  if (lump.valueSeries.length !== length || dca.valueSeries.length !== length) {
    throw new Error(
      `Value series differ in length: lump ${lump.valueSeries.length}, dca ${dca.valueSeries.length}, plan ${length}`,
    );
  }
  return plan.valueSeries.map((point, i) => {
    const lumpPoint = lump.valueSeries[i];
    const dcaPoint = dca.valueSeries[i];
    if (lumpPoint?.date !== point.date || dcaPoint?.date !== point.date) {
      throw new Error(`Value series disagree on the date at index ${i} (${point.date})`);
    }
    return {
      date: point.date,
      lump: lumpPoint.value,
      dca: dcaPoint.value,
      plan: point.value,
      invested: point.invested,
    };
  });
}

/**
 * One history window: the main (recommended allocation) one, or the longer equity-only one,
 * which is null when the response has none. The equity-only run ends where the main one does.
 */
export function historyView(plan: PlanOk, which: "main" | "equity"): HistoryView | null {
  let window = plan.window;
  let scenarios = plan.scenarios;
  if (which === "equity") {
    const { equityOnly } = plan;
    if (equityOnly === null) return null;
    window = { ...plan.window, from: equityOnly.from, years: equityOnly.years };
    scenarios = equityOnly;
  }
  const { maxDrawdown, worstYear, volatility } = scenarios.plan;
  return {
    window: { from: window.from, to: window.to, years: window.years },
    rows: SCENARIO_ORDER.map((key) => {
      const { invested, finalValue, xirr } = scenarios[key];
      return { key, invested, finalValue, xirr };
    }),
    metrics: { maxDrawdown, worstYear, volatility },
    series: chartSeries(scenarios),
  };
}
