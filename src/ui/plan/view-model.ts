// Pure shaping of a /api/plan response into what the 規劃 result screen shows. Every sentence
// comes from copy.ts; the numbers come only from the response (and the user's own monthly amount).
import type { Lens } from "@/insight/lens";
import type { PlanJson } from "@/ui/data/api";
import { formatRatio } from "@/ui/format";
import {
  ALTERNATE_PREFIX,
  CASH_DETAIL,
  LEVEL1_ABOUT_BAND,
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
  /** Whole-number share of `amounts.investable`. */
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

/** The slices that hold money, in table order; none for a reserve-only plan. */
export function sliceRows(plan: PlanJson): SliceRow[] {
  if (plan.kind === "reserve_only") return [];
  const { slices, investable } = plan.amounts;
  return SLICE_ORDER.filter((key) => slices[key] > 0).map((key) => ({
    key,
    label: SLICE_LABELS[key],
    amount: slices[key],
    percent: investable > 0 ? Math.round((slices[key] / investable) * 100) : 0,
    detail: sliceDetail(plan, key),
  }));
}

/**
 * How the money goes in. The plan scenario's own tranche months are used when the response has
 * one; a response without scenarios falls back to the rule's raw months. Nothing for reserve-only.
 */
export function rhythmLines(
  plan: PlanJson,
  monthly: number,
  lens: Lens = "beginner",
): { when: string; what: string }[] {
  if (plan.kind === "reserve_only") return [];
  const copy = RHYTHM_COPY[lens];
  const { investable } = plan.amounts;
  const months = plan.kind === "plan" ? plan.rhythm.trancheMonths : plan.amounts.trancheMonths;
  if (months === 1) {
    return [
      {
        when: monthly > 0 ? RHYTHM_ONCE_WHEN.withMonthly : RHYTHM_ONCE_WHEN.lumpOnly,
        what: copy.once({ lump: investable, monthly }),
      },
    ];
  }
  const part = Math.round(investable / months);
  const lines = [
    {
      when: rhythmRange(months),
      what: copy.tranche({ total: part + monthly, part, monthly, months }),
    },
  ];
  if (monthly > 0) lines.push({ when: rhythmFrom(months + 1), what: copy.ongoing(monthly) });
  return lines;
}

export function reserveView(plan: PlanJson): {
  target: number;
  gap: number;
  funded: boolean;
  monthsToFill: number | null;
} {
  const { reserveTarget, reserveGap, monthsToFillReserve } = plan.amounts;
  return {
    target: reserveTarget,
    gap: reserveGap,
    funded: reserveGap === 0,
    monthsToFill: monthsToFillReserve,
  };
}

export type Notice = { id: string; tone: "info" | "warn"; title: string; body: string };

/** Whether the printed drawdown sits in the band where 約兩成 is a fair summary. */
function aboutTwoTenths(maxDrawdown: number): boolean {
  const printed = Number((maxDrawdown * 100).toFixed(2));
  return printed >= LEVEL1_ABOUT_BAND.min && printed <= LEVEL1_ABOUT_BAND.max;
}

export function notices(plan: PlanJson): Notice[] {
  const list: Notice[] = [];
  if (plan.kind === "reserve_only") {
    const { reserveGap, monthsToFillReserve } = plan.amounts;
    list.push({
      id: "reserve-only",
      tone: "info",
      title: NOTICE_COPY.reserveOnly.title,
      body: NOTICE_COPY.reserveOnly.body(reserveGap, monthsToFillReserve),
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
  if (plan.kind === "plan" && plan.profile.level === 1) {
    const { maxDrawdown } = plan.scenarios.plan;
    list.push({
      id: "level1-bond",
      tone: "info",
      title: NOTICE_COPY.level1.title,
      body: NOTICE_COPY.level1.body(formatRatio(maxDrawdown), aboutTwoTenths(maxDrawdown)),
    });
  }
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
