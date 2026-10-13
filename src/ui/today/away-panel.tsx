import { cn } from "@/lib/utils";
import { formatPct, trendClass, trendOf } from "@/ui/format";
import { AWAY_NOTE, type AwayRow, type AwayView, monthDay, TRUNCATED_NOTE } from "@/ui/today/away";
import { TileGrid } from "@/ui/today/tile-grid";
import type { Tile } from "@/ui/today/view-model";

function awayTiles(view: AwayView): Tile[] {
  const tiles: Tile[] = [];
  if (view.cumulativePct !== null) {
    tiles.push({
      id: "cumulative",
      label: "台指期累計",
      value: formatPct(view.cumulativePct),
      trend: trendOf(view.cumulativePct),
    });
  }
  tiles.push({ id: "days", label: "有開盤", value: `${view.missedDays} 天`, trend: "flat" });
  if (view.strongFrom !== null && view.strongTo !== null) {
    tiles.push({
      id: "strong",
      label: "強勢族群數",
      value: `${view.strongFrom} → ${view.strongTo}`,
      trend: "flat",
    });
  }
  return tiles;
}

/** The 離開期間 content: computed numbers, then each missed day with its stored summary. */
export function AwayPanel({ view }: { view: AwayView }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">{`${view.from} → ${view.to} · 你離開的這幾天`}</p>
      <TileGrid tiles={awayTiles(view)} />
      <ol className="flex flex-col text-sm">
        {view.rows.map((row) => (
          <DayRow key={row.tradeDate} row={row} />
        ))}
      </ol>
      {view.truncated && <p className="text-xs text-muted-foreground">{TRUNCATED_NOTE}</p>}
      <p className="text-xs text-muted-foreground">{AWAY_NOTE}</p>
    </>
  );
}

function DayRow({ row }: { row: AwayRow }) {
  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 border-t py-2 first:border-t-0">
      <span className="text-xs font-semibold text-muted-foreground tabular-nums leading-5">
        {monthDay(row.tradeDate)}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {row.summary !== null ? (
          <span>{row.summary}</span>
        ) : (
          row.futuresChangePct !== null && (
            <span>
              台指期{" "}
              <span className={cn("tabular-nums", trendClass(trendOf(row.futuresChangePct)))}>
                {formatPct(row.futuresChangePct)}
              </span>
            </span>
          )
        )}
        {row.weekHeadline !== null && (
          <span className="text-xs text-muted-foreground">{row.weekHeadline}</span>
        )}
      </div>
    </li>
  );
}
