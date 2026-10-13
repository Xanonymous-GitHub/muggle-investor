import { useId } from "react";
import type { SectorMover } from "@/sources/darkfanxing/schemas";
import { trendClass } from "@/ui/format";
import { moverRows, type Row } from "@/ui/today/view-model";

type Group = { title: string; rows: Row[] };

/**
 * A card of ranked lists under one heading. Lists with no rows are left out, and the whole card
 * when every list is empty, so no heading ever stands over nothing.
 */
export function RankedCard({ title, groups }: { title: string; groups: Group[] }) {
  const id = useId();
  const shown = groups.filter((group) => group.rows.length > 0);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 id={id} className="text-sm font-bold">
        {title}
      </h2>
      {shown.map((group) => (
        <div key={group.title} className="flex flex-col">
          <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
          <ul className="flex flex-col divide-y">
            {group.rows.map((row) => (
              <li key={row.name} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">{row.name}</span>
                <span className={`shrink-0 tabular-nums ${trendClass(row.trend)}`}>
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** The day's strongest and weakest groups. */
export function MoversCard({
  gainers,
  losers,
}: {
  gainers: SectorMover[] | null;
  losers: SectorMover[] | null;
}) {
  return (
    <RankedCard
      title="領漲／領跌族群"
      groups={[
        { title: "領漲", rows: moverRows(gainers) },
        { title: "領跌", rows: moverRows(losers) },
      ]}
    />
  );
}
