"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, type TooltipContentProps, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type { Lens } from "@/insight/lens";
import { formatInt } from "@/ui/format";
import { useMediaQuery } from "@/ui/glossary/use-media-query";
import { HISTORY_COPY, scenarioLabel } from "@/ui/plan/copy";
import type { ChartPoint } from "@/ui/plan/view-model";

type LineKey = "plan" | "lump" | "dca" | "invested";

/** Legend and tooltip order: the table's order, then the invested total. */
const LINE_ORDER: readonly LineKey[] = ["lump", "dca", "plan", "invested"];

// Whole class names so Tailwind sees them; the colours are the --line-* tokens.
const SWATCH_CLASS: Record<LineKey, string> = {
  plan: "bg-line-plan",
  lump: "bg-line-lump",
  dca: "bg-line-dca",
  invested: "bg-line-invested",
};

const HEIGHT = 224;

/**
 * The first point of every second calendar year (every fourth on a window longer than 12 years),
 * so the x axis is labelled by year at an even spacing. A last tick within six months of the
 * series end is dropped: its label would clip at the right edge.
 */
export function yearTicks(series: readonly ChartPoint[]): string[] {
  const first = series[0];
  const last = series.at(-1);
  if (!first || !last) return [];
  const span = Number(last.date.slice(0, 4)) - Number(first.date.slice(0, 4));
  const step = span > 12 ? 4 : 2;
  const ticks: string[] = [];
  let previous = "";
  for (const { date } of series) {
    const year = date.slice(0, 4);
    if (year !== previous && Number(year) % step === 0) ticks.push(date);
    previous = year;
  }
  const lastTick = ticks.at(-1);
  if (lastTick !== undefined && monthsBetween(lastTick, last.date) < 6) ticks.pop();
  return ticks;
}

function monthsBetween(from: string, to: string): number {
  const months = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
  return months(to) - months(from);
}

const MIN_AXIS_WIDTH = 36;
const WAN = 10_000;
const MILLION = 1_000_000;

export type ValueAxis = {
  unit: "wan" | "million";
  /** A y tick (whole TWD) as the number printed on the axis. */
  format(value: number): string;
  /** Pixels for the tick labels: the longest label the series can print, at least 36. */
  width: number;
};

/**
 * The y axis counts in millions once the largest value (any line, the invested total too) reaches
 * a million, otherwise in 萬, so a small saver's ticks are not all 0. The width follows the
 * longest label: millions grow to four digits with billions, 萬 never passes 100.
 */
export function valueAxis(series: readonly ChartPoint[]): ValueAxis {
  const max = series.reduce((acc, p) => Math.max(acc, p.lump, p.dca, p.plan, p.invested), 0);
  const unit = max >= MILLION ? "million" : "wan";
  const divisor = unit === "million" ? MILLION : WAN;
  const numbers = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: unit === "million" ? 1 : 2,
  });
  const format = (value: number) => numbers.format(value / divisor);
  // About 7px a character at the axis' 12px, plus a little air; the minus sign never occurs.
  const width = Math.max(MIN_AXIS_WIDTH, format(max).length * 7 + 8);
  return { unit, format, width };
}

/** With no lump to invest only the plan run and the invested total are drawn. */
const MONTHLY_ONLY_LINES: readonly LineKey[] = ["plan", "invested"];

function labels(lens: Lens, trancheMonths: number, monthlyOnly: boolean): Record<LineKey, string> {
  return {
    plan: monthlyOnly ? HISTORY_COPY.monthlyRun[lens] : scenarioLabel("plan", lens, trancheMonths),
    lump: scenarioLabel("lump", lens, trancheMonths),
    dca: scenarioLabel("dca", lens, trancheMonths),
    invested: HISTORY_COPY.investedLine[lens],
  };
}

/**
 * The three scenarios' month-end values and the invested total, as lines. It is a picture of the
 * table beside it, so the whole figure is hidden from assistive technology. `trancheMonths`
 * names the recommended line. With `monthlyOnly` (no lump to invest) the three runs are one run:
 * only the plan line, named 每月投入, and the invested total are drawn.
 */
export function HistoryChart({
  series,
  lens,
  trancheMonths,
  monthlyOnly = false,
}: {
  series: ChartPoint[];
  lens: Lens;
  trancheMonths: number;
  monthlyOnly?: boolean;
}) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const names = useMemo(
    () => labels(lens, trancheMonths, monthlyOnly),
    [lens, trancheMonths, monthlyOnly],
  );
  const keys = monthlyOnly ? MONTHLY_ONLY_LINES : LINE_ORDER;
  const config = useMemo(
    () =>
      ({
        plan: { label: names.plan, color: "var(--line-plan)" },
        lump: { label: names.lump, color: "var(--line-lump)" },
        dca: { label: names.dca, color: "var(--line-dca)" },
        invested: { label: names.invested, color: "var(--line-invested)" },
      }) satisfies ChartConfig,
    [names],
  );
  const ticks = useMemo(() => yearTicks(series), [series]);
  const axis = useMemo(() => valueAxis(series), [series]);
  const animate = !reduceMotion;
  return (
    <div data-slot="history-chart" aria-hidden="true" className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{HISTORY_COPY.chartUnit[axis.unit]}</p>
      <ChartContainer
        config={config}
        initialDimension={{ width: 320, height: HEIGHT }}
        className="aspect-auto w-full"
        style={{ height: HEIGHT }}
      >
        {/* No keyboard layer: the figure is aria-hidden, so its SVG must not be a focus stop. */}
        <LineChart
          data={series}
          accessibilityLayer={false}
          margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            ticks={ticks}
            tickFormatter={(date: string) => date.slice(0, 4)}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis width={axis.width} tickLine={false} axisLine={false} tickFormatter={axis.format} />
          <ChartTooltip
            content={(props: TooltipContentProps) => (
              <HistoryTooltip {...props} names={names} keys={keys} />
            )}
          />
          <Line
            dataKey="invested"
            type="stepAfter"
            stroke="var(--color-invested)"
            strokeWidth={1.5}
            strokeDasharray="2 3"
            dot={false}
            isAnimationActive={animate}
          />
          {keys.includes("lump") ? (
            <Line
              dataKey="lump"
              type="monotone"
              stroke="var(--color-lump)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={animate}
            />
          ) : null}
          {keys.includes("dca") ? (
            <Line
              dataKey="dca"
              type="monotone"
              stroke="var(--color-dca)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={animate}
            />
          ) : null}
          <Line
            dataKey="plan"
            type="monotone"
            stroke="var(--color-plan)"
            strokeWidth={3}
            dot={false}
            isAnimationActive={animate}
          />
        </LineChart>
      </ChartContainer>
      <ul data-slot="history-legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {keys.map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span
              className={`shrink-0 ${key === "invested" ? "h-0 w-4 border-t-2 border-dotted border-line-invested" : `h-1 w-4 rounded-full ${SWATCH_CLASS[key]}`}`}
            />
            <span>{names[key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The hovered month: its date, the three values and the invested total, in legend order. */
export function HistoryTooltip({
  active,
  payload,
  names,
  keys = LINE_ORDER,
}: {
  active?: boolean;
  /** Recharts' payload: every entry carries the hovered data point. */
  payload?: readonly { payload?: unknown }[];
  names: Record<LineKey, string>;
  /** The lines to list, in order; all four by default. */
  keys?: readonly LineKey[];
}) {
  const point = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium tabular-nums">{point.date}</div>
      {keys.map((key) => (
        <div key={key} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className={`size-2 shrink-0 rounded-[2px] ${SWATCH_CLASS[key]}`} />
            {names[key]}
          </span>
          <span className="font-medium tabular-nums">
            {HISTORY_COPY.tooltipAmount(formatInt(point[key]))}
          </span>
        </div>
      ))}
    </div>
  );
}
