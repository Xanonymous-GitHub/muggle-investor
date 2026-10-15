import { useId } from "react";
import type { Lens } from "@/insight/lens";
import type { PlanJson } from "@/ui/data/api";
import { RHYTHM_HEADING } from "@/ui/plan/copy";
import { rhythmLines } from "@/ui/plan/view-model";

/** How the money goes in over the months. `monthly` is the request's monthly amount. */
export function RhythmCard({
  plan,
  monthly,
  lens,
}: {
  plan: PlanJson;
  monthly: number;
  lens: Lens;
}) {
  const id = useId();
  const lines = rhythmLines(plan, monthly, lens);
  if (lines.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 id={id} className="text-sm font-bold">
        {RHYTHM_HEADING}
      </h2>
      <ul className="flex flex-col divide-y">
        {lines.map((line) => (
          <li key={line.when} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
            <span className="text-xs font-medium text-muted-foreground">{line.when}</span>
            <p className="text-sm tabular-nums">{line.what}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
