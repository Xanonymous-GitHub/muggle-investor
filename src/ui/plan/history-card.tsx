"use client";

import { cn } from "cn";
import { type ReactNode, useId } from "react";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Lens } from "@/insight/lens";
import { formatInt, formatRatio, formatUnsignedRatio, ratioTrend, trendClass } from "@/ui/format";
import { HISTORY_COPY, HISTORY_LABELS, historyWindowLine, scenarioLabel } from "@/ui/plan/copy";
import { HistoryChart } from "@/ui/plan/history-chart";
import { type HistoryView, historyView, type PlanOk } from "@/ui/plan/view-model";

/**
 * 過去這樣做會怎樣: the recommended allocation's history and, behind a second tab, the longer
 * equity-only run. Only the tab on screen is rendered, so its window sentence, chart, table and
 * metrics always describe the same run.
 */
export function HistoryCard({ plan, lens }: { plan: PlanOk; lens: Lens }) {
  const id = useId();
  const main = historyView(plan, "main");
  const equity = historyView(plan, "equity");
  if (main === null) return null;
  const trancheMonths = plan.rhythm.trancheMonths;
  // The bond is the limit only when the bond-free run starts earlier: with no such run, or the
  // same start, another ETF (say a young dividend one) sets the window.
  const bondShortensWindow =
    plan.amounts.slices.bond > 0 &&
    plan.instruments.some((i) => i.category === "bond") &&
    plan.equityOnly !== null &&
    plan.equityOnly.from < plan.window.from;
  const mainPanel = (
    <HistoryPanel
      view={main}
      note={bondShortensWindow ? HISTORY_COPY.bondLimit : null}
      lens={lens}
      trancheMonths={trancheMonths}
    />
  );
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 id={id} className="text-sm font-bold">
        {HISTORY_COPY.heading[lens]}
      </h2>
      {equity === null ? (
        mainPanel
      ) : (
        <Tabs defaultValue="main" className="gap-3">
          {/* The triggers are the touch targets: 44px tall, the list grows around them. */}
          <TabsList className="w-full group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="main" className="h-11">
              {HISTORY_COPY.tabs.main}
            </TabsTrigger>
            <TabsTrigger value="equity" className="h-11">
              {HISTORY_COPY.tabs.equity}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="main">{mainPanel}</TabsContent>
          <TabsContent value="equity">
            <HistoryPanel
              view={equity}
              note={
                plan.instruments.some((i) => i.category === "dividend")
                  ? HISTORY_COPY.equityOnly.withDividend
                  : HISTORY_COPY.equityOnly.coreOnly
              }
              lens={lens}
              trancheMonths={trancheMonths}
            />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}

/** One run: its own window sentence, then the chart, the table and the plan's metrics. */
function HistoryPanel({
  view,
  note,
  lens,
  trancheMonths,
}: {
  view: HistoryView;
  note: string | null;
  lens: Lens;
  trancheMonths: number;
}) {
  const { metrics } = HISTORY_LABELS[lens];
  const windowLine = historyWindowLine(view.window, note);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground tabular-nums">{windowLine}</p>
      <HistoryChart series={view.series} lens={lens} trancheMonths={trancheMonths} />
      {/* keep-all: on a narrow screen a label breaks at its spaces and brackets, never inside a word. */}
      <Table className="text-xs tabular-nums [word-break:keep-all]">
        <TableCaption className="sr-only">{HISTORY_COPY.tableCaption(windowLine)}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-1.5 whitespace-normal text-muted-foreground">
              {HISTORY_COPY.scenarioHeader}
            </TableHead>
            <TableHead className="px-1.5 text-right whitespace-normal text-muted-foreground">
              {HISTORY_COPY.investedHeader}
            </TableHead>
            <TableHead className="px-1.5 text-right whitespace-normal text-muted-foreground">
              {HISTORY_COPY.finalHeader}
            </TableHead>
            <TableHead className="px-1.5 text-right whitespace-normal text-muted-foreground">
              {metrics.xirr}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.rows.map((row) => (
            <TableRow key={row.key} className="hover:bg-transparent">
              <TableHead scope="row" className="px-1.5 font-normal whitespace-normal">
                {scenarioLabel(row.key, lens, trancheMonths)}
              </TableHead>
              <TableCell className="px-1.5 text-right">{formatInt(row.invested)}</TableCell>
              <TableCell className="px-1.5 text-right">{formatInt(row.finalValue)}</TableCell>
              <TableCell className={cn("px-1.5 text-right", trendClass(ratioTrend(row.xirr)))}>
                <Ratio value={row.xirr} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <Metric label={metrics.maxDrawdown}>
          <span className={trendClass(ratioTrend(view.metrics.maxDrawdown))}>
            <Ratio value={view.metrics.maxDrawdown} />
          </span>
        </Metric>
        <Metric label={metrics.worstYear}>
          <span className={trendClass(ratioTrend(view.metrics.worstYear))}>
            <Ratio value={view.metrics.worstYear} />
          </span>
        </Metric>
        <Metric label={metrics.volatility}>
          {/* A spread, not a gain or a loss: no sign and no trend colour. This departs from the
              brief's ratioTrend on all three metrics on purpose (ruling R-U12). */}
          <span>{formatUnsignedRatio(view.metrics.volatility)}</span>
        </Metric>
      </dl>
      <p className="text-xs text-muted-foreground">{HISTORY_COPY.sameMoney}</p>
    </div>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted px-2 py-1.5">
      <dt className="text-balance text-muted-foreground">{label}</dt>
      <dd className="text-sm font-bold tabular-nums">{children}</dd>
    </div>
  );
}

/** A signed ratio, or `—` with the reason when the response could not compute it. */
function Ratio({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span title={HISTORY_COPY.tooShort}>
        {formatRatio(null)}
        <span className="sr-only">{HISTORY_COPY.tooShort}</span>
      </span>
    );
  }
  return <>{formatRatio(value)}</>;
}
