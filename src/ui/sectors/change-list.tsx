import { ArrowDownWideNarrowIcon, ArrowUpNarrowWideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Lens } from "@/insight/lens";
import type { SectorRow } from "@/sources/darkfanxing/schemas";
import { formatPct, trendClass, trendOf } from "@/ui/format";
import { plainChangeLine } from "@/ui/sectors/copy";
import type { SortDir } from "@/ui/sectors/view-model";

/** Colour by the figure as printed, so a value shown as 0.00 is never red or green. */
export function shownTrendClass(n: number, digits = 2): string {
  return trendClass(trendOf(Number(n.toFixed(digits))));
}

export function formatMonth(n: number | null): string {
  return n === null ? "—" : formatPct(n);
}

type Props = {
  rows: SectorRow[];
  lens: Lens;
  dir: SortDir;
  onToggleDir(): void;
  selected: string | null;
  onSelect(group: string): void;
};

/** The phone layout of the 漲跌幅 view: one tappable row per sector, ordered by the day's change. */
export function ChangeList({ rows, lens, dir, onToggleDir, selected, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onToggleDir}>
          {dir === "desc" ? <ArrowDownWideNarrowIcon /> : <ArrowUpNarrowWideIcon />}
          {dir === "desc" ? "由高到低" : "由低到高"}
        </Button>
      </div>
      <ul aria-label="族群排行" className="flex flex-col divide-y rounded-xl border bg-card">
        {rows.map((row) => (
          <li key={row.name}>
            <button
              type="button"
              aria-current={selected === row.name ? "true" : undefined}
              onClick={() => onSelect(row.name)}
              className="grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 px-4 py-3 text-left outline-none hover:bg-muted focus-visible:bg-muted aria-[current=true]:bg-muted"
            >
              <span data-slot="sector-name" className="min-w-0 truncate font-medium">
                {row.name}
              </span>
              <span
                className={`text-base font-semibold tabular-nums ${shownTrendClass(row.changePct)}`}
              >
                {formatPct(row.changePct)}
              </span>
              {lens === "beginner" ? (
                <span className="col-span-2 text-sm text-muted-foreground">
                  {plainChangeLine(row)}
                </span>
              ) : (
                <span className="col-span-2 flex gap-3 text-sm text-muted-foreground tabular-nums">
                  <span>{`漲 ${row.advancers}／跌 ${row.decliners}`}</span>
                  <span>{`近一月 ${formatMonth(row.change1mPct)}`}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
