"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { GlossaryTerm } from "@/glossary";
import {
  type BriefingJson,
  briefingLatestUrl,
  type RecapJson,
  recapUrl,
  type TodayResponse,
  todayUrl,
} from "@/ui/data/api";
import { useResource } from "@/ui/data/use-resource";
import { readLastSeen } from "@/ui/device/last-seen";
import { useSettings } from "@/ui/device/settings-provider";
import { useTermPanel } from "@/ui/glossary/term-panel";
import { StaleNotice } from "@/ui/shell/stale-notice";
import { awayView } from "@/ui/today/away";
import { FlowCard } from "@/ui/today/flow-card";
import { MoversCard } from "@/ui/today/movers-card";
import { TodayCard } from "@/ui/today/today-card";
import { useRecordVisit } from "@/ui/today/use-record-visit";
import { AI_NOTE, type BriefingState, briefingState, DISCLAIMER } from "@/ui/today/view-model";

const NO_TERMS: Record<string, GlossaryTerm> = {};

export function TodayScreen() {
  const { settings, ready } = useSettings();
  // The lens decides which briefing to load, so nothing is requested before it is known.
  const today = useResource<TodayResponse>(ready ? todayUrl() : null);
  const latest = useResource<BriefingJson>(ready ? briefingLatestUrl(settings.lens) : null);
  const since = useLastSeenOnArrival();
  // A failed recap just means no away tab; only `unavailable` (503) offers a retry.
  const recap = useResource<RecapJson>(since ? recapUrl(since) : null);
  const { open, panel } = useTermPanel(latest.status === "ready" ? latest.data.terms : NO_TERMS);
  useRecordVisit(today.status === "ready" ? (today.data.digest?.tradeDate ?? null) : null);

  if (today.status === "idle" || today.status === "loading") {
    return (
      <Frame>
        <TodaySkeleton />
      </Frame>
    );
  }
  if (today.status === "error") {
    return (
      <Frame>
        <p role="alert" className="text-sm text-muted-foreground">
          市場資料暫時載入失敗，請稍後再試。
        </p>
      </Frame>
    );
  }

  const { digest } = today.data;
  if (digest === null) {
    return (
      <Frame>
        <p className="text-sm text-muted-foreground">
          還沒有收盤資料。排程跑過之後這裡會出現今天的市場。
        </p>
      </Frame>
    );
  }

  // Still loading: null. Missing or unreadable: pending, while the numbers show as usual.
  let briefing: BriefingState | null = null;
  if (latest.status === "ready") briefing = briefingState(digest.tradeDate, latest.data);
  else if (latest.status === "error") briefing = briefingState(digest.tradeDate, null);

  return (
    <Frame>
      {/* Dated by the digest the tab shows, not by the newer intraday board in the same response. */}
      {today.refreshFailed && <StaleNotice dataDate={digest.tradeDate} />}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] md:items-start">
        <div className="flex flex-col gap-1.5">
          <TodayCard
            digest={digest}
            briefing={briefing}
            lens={settings.lens}
            onOpenTerm={open}
            away={awayView(recap.status === "ready" ? recap.data : null, settings.lens)}
            notice={
              recap.status === "error" &&
              recap.kind === "unavailable" && <RecapRetry onRetry={recap.reload} />
            }
            todayFooter={
              briefing !== null &&
              briefing.kind !== "pending" && (
                <p className="px-1 text-xs text-muted-foreground">{AI_NOTE}</p>
              )
            }
          />
        </div>
        <div className="flex flex-col gap-4">
          <MoversCard gainers={digest.topGainers} losers={digest.topLosers} />
          <FlowCard netBuy={digest.netBuy} netSell={digest.netSell} />
        </div>
      </div>
      <p className="px-1 text-xs text-muted-foreground">{DISCLAIMER}</p>
      {panel}
    </Frame>
  );
}

function RecapRetry({ onRetry }: { onRetry(): void }) {
  return (
    <div className="-mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>回顧暫時讀不到</span>
      <Button variant="ghost" size="xs" onClick={onRetry}>
        重試
      </Button>
    </div>
  );
}

/**
 * The last trade date this device saw before this visit. Read once after mount (local storage is
 * out of reach during the server render) and kept for the whole visit, so recording this visit
 * never makes the away tab disappear.
 */
function useLastSeenOnArrival(): string | null {
  const [since, setSince] = useState<string | null>(null);
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    setSince(readLastSeen());
  }, []);
  return since;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">今日</h1>
      {children}
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="載入中" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="h-2.5 w-full rounded-full" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
