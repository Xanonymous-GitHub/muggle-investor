"use client";

import { type ReactNode, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Lens } from "@/insight/lens";
import type { DigestSnapshot } from "@/sources/darkfanxing/schemas";
import { formatDataLine } from "@/ui/format";
import { TermChip } from "@/ui/glossary/term-chip";
import type { AwayView } from "@/ui/today/away";
import { AwayPanel } from "@/ui/today/away-panel";
import { BreadthBar } from "@/ui/today/breadth-bar";
import { TileGrid } from "@/ui/today/tile-grid";
import { type BriefingState, breadthBar, todayTiles } from "@/ui/today/view-model";

const PENDING_HEADLINE = "今天的解讀還在整理中";

type TodayPanelProps = {
  digest: DigestSnapshot;
  /** `null` while the briefing is still loading. */
  briefing: BriefingState | null;
  lens: Lens;
  onOpenTerm(termId: string): void;
};

type TodayCardProps = TodayPanelProps & {
  /** The away period to offer as a second tab, or null for the 今天 content alone. */
  away: AwayView | null;
  /** Shown under the card while the 今天 content is. */
  todayFooter?: ReactNode;
  /** A small note at the top of the card when there is no away tab (e.g. the recap failed). */
  notice?: ReactNode;
};

const CARD_CLASS = "flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-5";

/**
 * The main card of the Today screen. Without an away period it is the 今天 content alone. With
 * one it has two tabs: when the away period is there from the card's first render the card opens
 * on 離開期間 and 今天 carries a dot; when it arrives later the reader stays on 今天 and the dot
 * goes on 離開期間 instead. A dot clears once its tab is opened.
 */
export function TodayCard({ away, todayFooter, notice, ...panel }: TodayCardProps) {
  const [awayFromStart] = useState(away !== null);
  if (away === null) {
    return (
      <>
        <section aria-label="今天" className={CARD_CLASS}>
          {notice}
          <TodayPanel {...panel} />
        </section>
        {todayFooter}
      </>
    );
  }
  return (
    <TabbedCard
      away={away}
      initialTab={awayFromStart ? "away" : "today"}
      todayFooter={todayFooter}
      panel={panel}
    />
  );
}

type Tab = "today" | "away";

function TabbedCard({
  away,
  initialTab,
  todayFooter,
  panel,
}: {
  away: AwayView;
  initialTab: Tab;
  todayFooter: ReactNode;
  panel: TodayPanelProps;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // The tab not yet opened carries the dot.
  const [dotOn, setDotOn] = useState<Tab | null>(initialTab === "away" ? "today" : "away");
  const select = (value: string) => {
    const next: Tab = value === "today" ? "today" : "away";
    setTab(next);
    if (next === dotOn) setDotOn(null);
  };
  return (
    <>
      <section className={CARD_CLASS}>
        <Tabs value={tab} onValueChange={select} className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="today">
              今天
              {dotOn === "today" && <Dot label="有今天的新內容" />}
            </TabsTrigger>
            <TabsTrigger value="away">
              {`離開期間（${away.missedDays} 日）`}
              {dotOn === "away" && <Dot label="有離開期間的回顧" />}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="today" className="flex flex-col gap-4">
            <TodayPanel {...panel} />
          </TabsContent>
          <TabsContent value="away" className="flex flex-col gap-4">
            <AwayPanel view={away} />
          </TabsContent>
        </Tabs>
      </section>
      {tab === "today" && todayFooter}
    </>
  );
}

function Dot({ label }: { label: string }) {
  return <span role="img" aria-label={label} className="size-1.5 shrink-0 rounded-full bg-up" />;
}

/**
 * The 今天 content: always the latest closed digest, dated by its own trade date. The headline
 * speaks for that day only when the briefing does; an older briefing is shown as older.
 */
export function TodayPanel({ digest, briefing, lens, onOpenTerm }: TodayPanelProps) {
  const breadth = breadthBar(digest.market);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">{formatDataLine(digest)}</p>
        <Headline briefing={briefing} />
      </div>
      {breadth && <BreadthBar breadth={breadth} />}
      <TileGrid tiles={todayTiles(digest, lens)} />
      {briefing?.kind === "current" && <BriefingBody briefing={briefing} onOpenTerm={onOpenTerm} />}
    </>
  );
}

function Headline({ briefing }: { briefing: BriefingState | null }) {
  if (briefing === null) {
    return <Skeleton className="h-8 w-4/5" />;
  }
  const headingClass = "text-xl font-extrabold leading-snug text-balance md:text-2xl";
  if (briefing.kind === "current") return <h2 className={headingClass}>{briefing.headline}</h2>;
  return (
    <>
      <h2 className={headingClass}>{PENDING_HEADLINE}</h2>
      {briefing.kind === "older" && (
        <p className="text-sm text-muted-foreground">
          {`${briefing.periodKey} 的解讀：${briefing.headline}`}
        </p>
      )}
    </>
  );
}

function BriefingBody({
  briefing,
  onOpenTerm,
}: {
  briefing: Extract<BriefingState, { kind: "current" }>;
  onOpenTerm(termId: string): void;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <p className="text-base">{briefing.summary}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {briefing.sections.map((section) => (
          <section key={section.title} className="rounded-lg bg-muted px-3 py-2.5">
            <h3 className="mb-0.5 font-bold">{section.title}</h3>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
      <p className="text-muted-foreground">{briefing.takeaway}</p>
      {briefing.termIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {briefing.termIds.map((id) => (
            <TermChip key={id} termId={id} onOpen={onOpenTerm} />
          ))}
        </div>
      )}
    </div>
  );
}
