import { useId } from "react";
import type { Lens } from "@/insight/lens";
import type { FlowRow } from "@/sources/darkfanxing/schemas";
import { formatPct, formatYi } from "@/ui/format";
import { shownTrendClass } from "@/ui/sectors/change-list";
import { FLOW_NOTE, plainFlowLine } from "@/ui/sectors/copy";

const FLOW_ROWS = 10;

const TITLES: Record<Lens, { buy: string; sell: string }> = {
  beginner: { buy: "買的人比賣的人多（錢流進來）", sell: "賣的人比買的人多（錢流出去）" },
  pro: { buy: "淨流入前十", sell: "淨流出前十" },
};

const NO_FLOW = "這一天沒有資金流向資料。";

type Props = {
  netBuy: FlowRow[] | null;
  netSell: FlowRow[] | null;
  lens: Lens;
  selected: string | null;
  onSelect(group: string): void;
};

/** The digest's top inflows and outflows only; the backend has no flow figure for every sector. */
export function FlowView({ netBuy, netSell, lens, selected, onSelect }: Props) {
  if (netBuy === null && netSell === null) {
    return <p className="text-sm text-muted-foreground">{NO_FLOW}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{FLOW_NOTE}</p>
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        {[
          { title: TITLES[lens].buy, rows: netBuy },
          { title: TITLES[lens].sell, rows: netSell },
        ].map(({ title, rows }) => (
          <FlowSection
            key={title}
            title={title}
            rows={rows}
            lens={lens}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function FlowSection({
  title,
  rows,
  lens,
  selected,
  onSelect,
}: { title: string; rows: FlowRow[] | null } & Omit<Props, "netBuy" | "netSell">) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="px-1 text-sm font-bold">
        {title}
      </h2>
      {rows === null || rows.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{NO_FLOW}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {rows.slice(0, FLOW_ROWS).map((row) => (
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
                <span className={`font-semibold tabular-nums ${shownTrendClass(row.netFlow)}`}>
                  {formatYi(row.netFlow)}
                </span>
                {lens === "beginner" ? (
                  <span className="col-span-2 text-sm text-muted-foreground">
                    {plainFlowLine(row.netFlow)}
                  </span>
                ) : (
                  <span className="col-span-2 text-sm text-muted-foreground tabular-nums">
                    {"漲跌幅 "}
                    <span className={shownTrendClass(row.changePct)}>
                      {formatPct(row.changePct)}
                    </span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
