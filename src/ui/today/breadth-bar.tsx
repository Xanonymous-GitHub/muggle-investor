import type { Breadth } from "@/ui/today/view-model";

/** Rising against falling groups. Facts only: no dial, no score. The counts are the labels. */
export function BreadthBar({ breadth }: { breadth: Breadth }) {
  const { up, down, upPct } = breadth;
  return (
    <div className="flex flex-col gap-1">
      <div aria-hidden="true" className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="bg-up" style={{ width: `${upPct}%` }} />
        <div className="flex-1 bg-down" />
      </div>
      <div className="flex justify-between text-xs tabular-nums">
        <span className="text-up">{`上漲族群 ${up}`}</span>
        <span className="text-down">{`下跌族群 ${down}`}</span>
      </div>
    </div>
  );
}
