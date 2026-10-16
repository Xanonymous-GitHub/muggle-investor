import { useId } from "react";
import type { Lens } from "@/insight/lens";
import type { PlanJson } from "@/ui/data/api";
import { ALLOCATION_COPY, type SliceKey } from "@/ui/plan/copy";
import { monthlyOnly, sliceRows } from "@/ui/plan/view-model";

// Whole class names so Tailwind sees them; the colours are the --slice-* tokens.
const SLICE_CLASS: Record<SliceKey, string> = {
  core: "bg-slice-core",
  bond: "bg-slice-bond",
  dividend: "bg-slice-dividend",
  satellite: "bg-slice-satellite",
  cash: "bg-slice-cash",
};

/**
 * Where the investable money goes: a stacked bar sized by amount, then one row per slice. The
 * rows carry the same facts as text, so the bar is a labelled picture and nothing more.
 */
export function AllocationCard({
  plan,
  lens,
  monthly,
}: {
  plan: PlanJson;
  lens: Lens;
  /** The request's monthly amount: what is split when nothing is invested now. */
  monthly: number;
}) {
  const id = useId();
  const rows = sliceRows(plan, monthly);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 id={id} className="text-sm font-bold">
        {monthlyOnly(plan, monthly)
          ? ALLOCATION_COPY.monthlyTitle(monthly)
          : ALLOCATION_COPY.title(plan.amounts.investable)}
      </h2>
      <div
        role="img"
        aria-label={ALLOCATION_COPY.barLabel(rows)}
        className="flex h-4 gap-0.5 overflow-hidden rounded-full"
      >
        {rows.map((row) => (
          <span
            key={row.key}
            style={{ flexGrow: row.amount, flexBasis: 0 }}
            className={SLICE_CLASS[row.key]}
          />
        ))}
      </div>
      <ul className="flex flex-col divide-y">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-0.5 py-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`size-3 shrink-0 self-center rounded-sm ${SLICE_CLASS[row.key]}`}
                />
                <span>{row.label}</span>
                <span className="text-muted-foreground tabular-nums">{`${row.percent}%`}</span>
              </span>
              <span className="shrink-0 font-bold tabular-nums">
                {ALLOCATION_COPY.amount(row.amount)}
              </span>
            </div>
            {row.detail === null ? null : (
              <p className="text-xs text-muted-foreground">{row.detail}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{ALLOCATION_COPY.footnote[lens]}</p>
    </section>
  );
}
