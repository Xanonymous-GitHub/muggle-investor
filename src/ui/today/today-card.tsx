import { Skeleton } from "@/components/ui/skeleton";
import type { Lens } from "@/insight/lens";
import type { DigestSnapshot } from "@/sources/darkfanxing/schemas";
import { formatDataLine } from "@/ui/format";
import { TermChip } from "@/ui/glossary/term-chip";
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

/** The main card of the Today screen. It holds the 今天 content; the away tab joins it later. */
export function TodayCard(props: TodayPanelProps) {
  return (
    <section aria-label="今天" className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-5">
      <TodayPanel {...props} />
    </section>
  );
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
