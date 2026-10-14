"use client";

import { type ReactNode, Suspense, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SectorBoard } from "@/sources/darkfanxing/schemas";
import { sectorsUrl, type TodayResponse, todayUrl } from "@/ui/data/api";
import { type ResourceState, useResource } from "@/ui/data/use-resource";
import { useSettings } from "@/ui/device/settings-provider";
import { formatDataLine } from "@/ui/format";
import { useMediaQuery } from "@/ui/glossary/use-media-query";
import { ChangeList } from "@/ui/sectors/change-list";
import { ChangeTable, type TableSort } from "@/ui/sectors/change-table";
import { SECTOR_HELP_BODY, SECTOR_HELP_TITLE, VIEW_LABELS } from "@/ui/sectors/copy";
import { FlowView } from "@/ui/sectors/flow-view";
import { QuadrantView } from "@/ui/sectors/quadrant-view";
import { SectorDetail } from "@/ui/sectors/sector-detail";
import { useSelectedGroup } from "@/ui/sectors/use-selected-group";
import {
  filterSectors,
  type SectorView,
  type SortDir,
  type SortKey,
  sortSectors,
} from "@/ui/sectors/view-model";
import { StaleNotice } from "@/ui/shell/stale-notice";

const WIDE_QUERY = "(min-width: 768px)";
const VIEWS: SectorView[] = ["change", "flow", "quadrant"];

/**
 * `useSearchParams` (the chosen `?group=`) opts the page out of server rendering under vinext
 * unless it sits in a Suspense boundary, so the server sends this fallback and the client renders
 * the screen.
 */
export function SectorsScreen() {
  return (
    <Suspense
      fallback={
        <Frame>
          <ListSkeleton />
        </Frame>
      }
    >
      <SectorsContent />
    </Suspense>
  );
}

function SectorsContent() {
  const { settings } = useSettings();
  const lens = settings.lens;
  const board = useResource<SectorBoard>(sectorsUrl());
  // Flow and quadrant come from the closing digest, which carries its own date.
  const today = useResource<TodayResponse>(todayUrl());
  // False on the first render (server and hydration agree on the phone list), then the real width.
  const wide = useMediaQuery(WIDE_QUERY);
  const { selected, select, close } = useSelectedGroup();

  const [view, setView] = useState<SectorView>("change");
  const [query, setQuery] = useState("");
  const [listDir, setListDir] = useState<SortDir>("desc");
  const [tableSort, setTableSort] = useState<TableSort>({ key: "changePct", dir: "desc" });

  const sectors = board.status === "ready" ? board.data.sectors : null;
  const sort = wide ? tableSort : { key: "changePct" as const, dir: listDir };
  const rows = useMemo(
    () => (sectors === null ? [] : sortSectors(filterSectors(sectors, query), sort.key, sort.dir)),
    [sectors, query, sort.key, sort.dir],
  );

  const onSort = (key: SortKey) =>
    setTableSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );

  // Each view is labelled with the date of the data it shows: the board may be intraday while
  // the digest is the last close.
  const digest = today.status === "ready" ? today.data.digest : null;
  const dated = view === "change" ? (board.status === "ready" ? board.data : null) : digest;
  const dataLine = dated === null ? null : formatDataLine(dated);

  // On a phone the detail takes the list's place; the list's own state (search, view, sort)
  // lives in this component, so it is all still there after 返回.
  if (selected !== null && !wide) {
    return (
      <Frame dataLine={dataLine}>
        <SectorDetail key={selected} group={selected} onClose={close} />
      </Frame>
    );
  }

  const tabs = (
    <>
      {lens === "beginner" && (
        <aside className="rounded-xl border bg-muted px-4 py-3 text-sm">
          <p className="font-bold">{SECTOR_HELP_TITLE}</p>
          <p className="text-muted-foreground">{SECTOR_HELP_BODY}</p>
        </aside>
      )}

      <Tabs value={view} onValueChange={(next) => setView(next as SectorView)} className="gap-4">
        <TabsList className="grid h-auto w-full grid-cols-3 group-data-horizontal/tabs:h-auto">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v} className="py-1.5 whitespace-normal">
              {VIEW_LABELS[lens][v]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="change" className="flex flex-col gap-3">
          <Input
            type="search"
            aria-label="搜尋族群"
            placeholder="搜尋族群"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          <Loaded state={board} what="族群" empty="還沒有族群資料。">
            {(data, refreshFailed) => (
              <>
                {refreshFailed && <StaleNotice dataDate={data.tradeDate} />}
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">找不到符合的族群。</p>
                ) : wide ? (
                  <ChangeTable
                    rows={rows}
                    lens={lens}
                    sort={tableSort}
                    onSort={onSort}
                    selected={selected}
                    onSelect={select}
                  />
                ) : (
                  <ChangeList
                    rows={rows}
                    lens={lens}
                    dir={listDir}
                    onToggleDir={() => setListDir((d) => (d === "desc" ? "asc" : "desc"))}
                    selected={selected}
                    onSelect={select}
                  />
                )}
              </>
            )}
          </Loaded>
        </TabsContent>

        <TabsContent value="flow" className="flex flex-col gap-3">
          <DigestPart state={today}>
            {(d) => (
              <FlowView
                netBuy={d.netBuy}
                netSell={d.netSell}
                lens={lens}
                selected={selected}
                onSelect={select}
              />
            )}
          </DigestPart>
        </TabsContent>

        <TabsContent value="quadrant" className="flex flex-col gap-3">
          <DigestPart state={today}>
            {(d) => <QuadrantView quadrant={d.quadrant} selected={selected} onSelect={select} />}
          </DigestPart>
        </TabsContent>
      </Tabs>
    </>
  );

  return (
    <Frame dataLine={dataLine}>
      {wide ? (
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-4">
          <div className="flex min-w-0 flex-col gap-4">{tabs}</div>
          {/* Capped to the viewport and scrolling on its own, so a long stock list stays reachable. */}
          <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            {selected === null ? (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                點選左邊的族群，看它裡面有哪些股票。
              </p>
            ) : (
              <SectorDetail key={selected} group={selected} onClose={close} />
            )}
          </div>
        </div>
      ) : (
        tabs
      )}
    </Frame>
  );
}

function Frame({ dataLine = null, children }: { dataLine?: string | null; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold">族群</h1>
        {dataLine && <p className="text-xs text-muted-foreground">{dataLine}</p>}
      </div>
      {children}
    </div>
  );
}

/** Skeleton while loading, a message when there is nothing, else the data (and whether it is stale). */
function Loaded<T>({
  state,
  what,
  empty,
  children,
}: {
  state: ResourceState<T>;
  what: string;
  empty: string;
  children(data: T, refreshFailed: boolean): ReactNode;
}) {
  if (state.status === "idle" || state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") {
    if (state.kind === "not_found") return <p className="text-sm text-muted-foreground">{empty}</p>;
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {`${what}資料暫時載入失敗，請稍後再試。`}
      </p>
    );
  }
  return children(state.data, state.refreshFailed);
}

function DigestPart({
  state,
  children,
}: {
  state: ResourceState<TodayResponse>;
  children(digest: NonNullable<TodayResponse["digest"]>): ReactNode;
}) {
  return (
    <Loaded state={state} what="市場" empty="還沒有收盤資料。">
      {(data, refreshFailed) =>
        data.digest === null ? (
          <p className="text-sm text-muted-foreground">還沒有收盤資料。</p>
        ) : (
          <>
            {refreshFailed && <StaleNotice dataDate={data.digest.tradeDate} />}
            {children(data.digest)}
          </>
        )
      }
    </Loaded>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="載入中" className="flex flex-col gap-2">
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-16 rounded-xl" />
    </div>
  );
}
