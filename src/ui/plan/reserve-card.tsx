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
  const { target, gap, remainingGap, have, deposit } = view;
  return (
    <section
      aria-label={RESERVE_COPY.label}
      className="flex flex-col gap-1 rounded-xl border bg-card p-4"
    >
      <p className="text-sm font-bold tabular-nums">
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
