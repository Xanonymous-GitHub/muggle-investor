"use client";

import { CartesianGrid, Line, LineChart, type TooltipContentProps, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type { Lens } from "@/insight/lens";
import { formatInt } from "@/ui/format";
import { useMediaQuery } from "@/ui/glossary/use-media-query";
import { HISTORY_COPY, scenarioLabel } from "@/ui/plan/copy";
import type { ChartPoint } from "@/ui/plan/view-model";

type LineKey = "plan" | "lump" | "dca" | "invested";

/** Legend and tooltip order: the recommended way first, the invested total last. */
const LINE_ORDER: readonly LineKey[] = ["plan", "lump", "dca", "invested"];

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
 * so the x axis is labelled by year at an even spacing.
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
  return ticks;
}

const millions = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function labels(lens: Lens, trancheMonths: number): Record<LineKey, string> {
  return {
    plan: scenarioLabel("plan", lens, trancheMonths),
    lump: scenarioLabel("lump", lens, trancheMonths),
    dca: scenarioLabel("dca", lens, trancheMonths),
    invested: HISTORY_COPY.investedLine[lens],
  };
}

/**
 * The three scenarios' month-end values and the invested total, as lines. It is a picture of the
 * table beside it, so the whole figure is hidden from assistive technology. `trancheMonths`
 * names the recommended line.
 */
export function HistoryChart({
  series,
  lens,
  trancheMonths,
}: {
  series: ChartPoint[];
  lens: Lens;
  trancheMonths: number;
}) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const names = labels(lens, trancheMonths);
  const config = {
    plan: { label: names.plan, color: "var(--line-plan)" },
    lump: { label: names.lump, color: "var(--line-lump)" },
    dca: { label: names.dca, color: "var(--line-dca)" },
    invested: { label: names.invested, color: "var(--line-invested)" },
  } satisfies ChartConfig;
  const animate = !reduceMotion;
  return (
    <div data-slot="history-chart" aria-hidden="true" className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{HISTORY_COPY.chartUnit}</p>
      <ChartContainer
        config={config}
        initialDimension={{ width: 320, height: HEIGHT }}
        className="aspect-auto w-full"
        style={{ height: HEIGHT }}
      >
        <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            ticks={yearTicks(series)}
            tickFormatter={(date: string) => date.slice(0, 4)}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            width={36}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => millions.format(value / 1_000_000)}
          />
          <ChartTooltip
            content={(props: TooltipContentProps) => <HistoryTooltip {...props} names={names} />}
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
          <Line
            dataKey="lump"
            type="monotone"
            stroke="var(--color-lump)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={animate}
          />
          <Line
            dataKey="dca"
            type="monotone"
            stroke="var(--color-dca)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={animate}
          />
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
        {LINE_ORDER.map((key) => (
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
}: {
  active?: boolean;
  /** Recharts' payload: every entry carries the hovered data point. */
  payload?: readonly { payload?: unknown }[];
  names: Record<LineKey, string>;
}) {
  const point = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium tabular-nums">{point.date}</div>
      {LINE_ORDER.map((key) => (
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
