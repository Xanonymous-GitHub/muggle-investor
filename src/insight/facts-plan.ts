import { createHash } from "node:crypto";
import type { PlanReference, ReferenceMetrics } from "@/planner/plan-service";
import type { Slice } from "@/planner/rules/allocation";
import type { RiskLevel } from "@/planner/rules/questionnaire";
import { type FactSheet, factSheetFromText, nameOf, num, oneLine, round2 } from "./facts";
import { isoWeekKey } from "./week";

/** Spec 「風險輪廓」: the five level names. */
export const LEVEL_NAMES: Record<RiskLevel, string> = {
  1: "保守",
  2: "穩健",
  3: "平衡",
  4: "積極",
  5: "進取",
};

/** Slices in the order the fact sheet lists them, with the label each line starts with. */
const SLICE_LABELS: readonly { slice: Slice; label: string }[] = [
  { slice: "core", label: "核心：市值型 ETF" },
  { slice: "bond", label: "債券：債券 ETF" },
  { slice: "dividend", label: "高股息：高股息 ETF" },
  { slice: "satellite", label: "衛星：" },
  { slice: "cash", label: "現金：" },
];

/** What the satellite and cash lines say after their weight; neither holds a named fund. */
const SATELLITE_NOTE = "沒有指定單一標的，試算時以核心標的的含息報酬代替";
const CASH_NOTE = "試算時不計報酬";
const RUN_METHOD =
  "- 試算方式：期初一次全部投入，每年依目標比例再平衡一次，配息再投入，不計手續費與稅；" +
  "這是一次性的歷史試算";

/**
 * A ratio as a percent with exactly two decimals (0.06 → "6.00", -0.229 → "-22.90"), so the model
 * may round any figure by one place. Rounds half away from zero first; -0 is written "0.00".
 */
const percent2 = (ratio: number): string => {
  const value = round2(ratio * 100);
  return (value === 0 ? 0 : value).toFixed(2);
};

/** `percent2` with an explicit "+" on positive values, followed by "%". */
const signedPercent2 = (ratio: number): string => {
  const text = percent2(ratio);
  return `${Number(text) > 0 ? "+" : ""}${text}%`;
};

/**
 * The run's metrics as labelled percents; `年化報酬率` and `最差滾動十二個月` are left out when null.
 * Volatility is never negative, so it is written without a sign.
 */
function metricsText(m: ReferenceMetrics): string {
  return [
    ...(m.cagr === null ? [] : [`年化報酬率 ${signedPercent2(m.cagr)}`]),
    `最大回撤 ${signedPercent2(m.maxDrawdown)}`,
    `年化波動度 ${percent2(m.volatility)}%`,
    ...(m.worstYear === null ? [] : [`最差滾動十二個月 ${signedPercent2(m.worstYear)}`]),
  ].join("、");
}

/** The equity-only run holds the dividend fund only when one qualifies (`planReference`). */
const equityFunds = (reference: PlanReference): string =>
  reference.instruments.some((i) => i.category === "dividend") ? "核心與高股息" : "核心";

function sliceLine(reference: PlanReference, slice: Slice, label: string): string {
  const weight = `${num(reference.weights[slice])}%`;
  const prefix = label.endsWith("：") ? `${label}${weight}` : `${label} ${weight}`;
  if (slice === "satellite") return `- ${prefix}，${SATELLITE_NOTE}`;
  if (slice === "cash") return `- ${prefix}，${CASH_NOTE}`;
  const instrument = reference.instruments.find((i) => i.category === slice);
  if (!instrument) throw new Error(`No instrument for the held ${slice} slice`);
  return `- ${prefix}，標的是 ${nameOf(instrument.name)}（${oneLine(instrument.symbol, 12)}）`;
}

/**
 * Builds the fact sheet for one level's reference run (`planReference`): the level, each held
 * slice with its integer weight and fund, the run's window and method, its metrics as percents
 * rounded to two decimals, the equity-only run when there is one, and the run date. A slice held
 * as cash because no fund qualifies is part of the cash weight, and its warning is written as a
 * 提醒 line. Slices at 0% are left out. The sheet holds ratios only, never a money amount, and
 * every number the LLM may copy is written in the text exactly as it may be copied. Metrics carry
 * exactly two decimals, so a one-place rounding of each stays grounded.
 *
 * `periodKey` is the ISO week of `reference.asOf` (the run date); the 資料到 line is the last
 * data day (`window.to`). Throws when the weights do not sum to 100 or a
 * held fund slice has no instrument.
 */
export function buildPlanFacts(reference: PlanReference): FactSheet {
  const { level, weights, window, equityOnly } = reference;
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total !== 100) {
    throw new Error(`Level ${level} weights sum to ${total}, expected 100`);
  }

  const lines = [
    `- 風險等級：${num(level)}（${LEVEL_NAMES[level]}）`,
    ...SLICE_LABELS.filter(({ slice }) => weights[slice] > 0).map(({ slice, label }) =>
      sliceLine(reference, slice, label),
    ),
    ...reference.warnings.map((warning) => `- 提醒：${oneLine(warning, 80)}`),
    `- 資料期間：${window.from} 至 ${window.to}（${num(window.years)} 年）`,
    RUN_METHOD,
    `- 歷史試算結果：${metricsText(reference.metrics)}`,
    ...(equityOnly
      ? [
          `- 只有股票（${equityFunds(reference)}，不含債券與現金）的歷史試算：` +
            `資料期間 ${equityOnly.from} 起（${num(equityOnly.years)} 年），` +
            metricsText(equityOnly.metrics),
        ]
      : []),
    `- 資料到：${window.to}`,
  ];
  return factSheetFromText(isoWeekKey(reference.asOf), lines.join("\n"));
}

/**
 * sha256 (hex) of the reference's structure: level, weights, funds (category, symbol, name),
 * warnings and the start dates of both runs. Metric figures, the window end and the run date are
 * left out, so a new trading day does not change it but a fund switch or a slice held as cash does.
 */
export function planFingerprint(reference: PlanReference): string {
  const structure = {
    level: reference.level,
    weights: SLICE_LABELS.map(({ slice }) => [slice, reference.weights[slice]]),
    instruments: reference.instruments.map((i) => [i.category, i.symbol, i.name]),
    warnings: reference.warnings,
    from: reference.window.from,
    equityFrom: reference.equityOnly?.from ?? null,
  };
  return createHash("sha256").update(JSON.stringify(structure)).digest("hex");
}
