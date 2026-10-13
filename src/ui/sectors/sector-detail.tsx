"use client";

import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SectorDetailJson } from "@/ui/data/api";
import { sectorDetailUrl } from "@/ui/data/api";
import { useResource } from "@/ui/data/use-resource";
import { formatDataLine, formatPct } from "@/ui/format";
import { formatMonth, shownTrendClass } from "@/ui/sectors/change-list";
import { StaleNotice } from "@/ui/shell/stale-notice";

const DEFAULT_RETRY_SECONDS = 60;

type Props = {
  group: string;
  onClose(): void;
};

/**
 * The stocks inside one sector. A pane beside the list from `md` up; on a phone it takes the
 * list's place, which is what the 返回 button (hidden from `md`) is for.
 */
export function SectorDetail({ group, onClose }: Props) {
  const state = useResource<SectorDetailJson>(sectorDetailUrl(group));

  let body: ReactNode;
  if (state.status === "idle" || state.status === "loading") {
    body = (
      <div role="status" aria-busy="true" aria-label="載入中" className="flex flex-col gap-2">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    );
  } else if (state.status === "error") {
    if (state.kind === "not_found") {
      body = <p className="text-sm text-muted-foreground">找不到這個族群。</p>;
    } else {
      body = (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <p className="text-muted-foreground">
            {state.kind === "busy"
              ? `暫時查不到，約 ${state.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS} 秒後再試。`
              : "暫時讀不到成分股。"}
          </p>
          <Button variant="outline" size="sm" onClick={state.reload}>
            重試
          </Button>
        </div>
      );
    }
  } else {
    body = (
      <>
        {state.refreshFailed && <StaleNotice dataDate={state.data.tradeDate} />}
        <Loaded detail={state.data} />
      </>
    );
  }

  return (
    <section
      aria-label={`${group}成分股`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="md:hidden">
        <Button variant="ghost" size="sm" onClick={onClose} className="-ml-2">
          <ChevronLeftIcon />
          返回
        </Button>
      </div>
      {body}
    </section>
  );
}

function Loaded({ detail }: { detail: SectorDetailJson }) {
  const dataLine = formatDataLine({
    tradeDate: detail.tradeDate,
    asOf: detail.asOf,
    session: "unknown",
  });
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{detail.group}</h2>
        <p className="text-xs text-muted-foreground">{dataLine}</p>
        <p className="flex flex-wrap items-baseline gap-x-3 text-sm tabular-nums">
          <span className="text-muted-foreground">{`第 ${detail.rank} / ${detail.rankOf}`}</span>
          <span className={`font-semibold ${shownTrendClass(detail.changePct)}`}>
            {formatPct(detail.changePct)}
          </span>
          <span className="text-muted-foreground">{`近一月 ${formatMonth(detail.change1mPct)}`}</span>
        </p>
      </div>
      {detail.stocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">這個族群目前沒有成分股資料。</p>
      ) : (
        <ul aria-label="成分股" className="flex flex-col divide-y">
          {detail.stocks.map((stock) => (
            <li
              key={stock.code}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium">{stock.name}</span>
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  {stock.code}
                </span>
              </span>
              {stock.noTrade ? (
                <span className="text-muted-foreground">今天沒成交</span>
              ) : (
                <span className={`font-semibold tabular-nums ${shownTrendClass(stock.changePct)}`}>
                  {formatPct(stock.changePct)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
