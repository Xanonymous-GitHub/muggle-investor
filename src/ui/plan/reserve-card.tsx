import { useId } from "react";
import { RESERVE_COPY } from "@/ui/plan/copy";
import type { reserveView } from "@/ui/plan/view-model";

/**
 * The emergency reserve against the request. `detail` adds where this time's money goes when the
 * lump closes the gap; the reserve-only screen leaves it out because its notice says so already.
 */
export function ReserveCard({
  view,
  detail = true,
}: {
  view: ReturnType<typeof reserveView>;
  detail?: boolean;
}) {
  const id = useId();
  const { target, gap, remainingGap, have, deposit } = view;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <h2 id={id} className="text-sm font-bold">
        {RESERVE_COPY.label}
      </h2>
      <p className="text-base font-semibold tabular-nums">
        {RESERVE_COPY.status({ target, gap, remaining: remainingGap })}
      </p>
      {detail && gap > 0 && remainingGap === 0 ? (
        <p className="text-sm text-muted-foreground tabular-nums">
          {RESERVE_COPY.filled({ have, deposit })}
        </p>
      ) : null}
    </section>
  );
}
