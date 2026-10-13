import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Lens } from "@/insight/lens";
import { cn } from "@/lib/utils";
import type { SectorRow } from "@/sources/darkfanxing/schemas";
import { formatPct } from "@/ui/format";
import { formatMonth, shownTrendClass } from "@/ui/sectors/change-list";
import { plainChangeLine } from "@/ui/sectors/copy";
import type { SortDir, SortKey } from "@/ui/sectors/view-model";

export type TableSort = { key: SortKey; dir: SortDir };

type Props = {
  rows: SectorRow[];
  lens: Lens;
  sort: TableSort;
  onSort(key: SortKey): void;
  selected: string | null;
  onSelect(group: string): void;
};

const turnoverFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** The `md`-and-up layout of the 漲跌幅 view: a table sortable by its column headers. */
export function ChangeTable({ rows, lens, sort, onSort, selected, onSelect }: Props) {
  const header = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <SortHeader
      label={label}
      align={align}
      active={sort.key === key}
      dir={sort.dir}
      onSort={() => onSort(key)}
    />
  );
  return (
    <div className="rounded-xl border bg-card px-2">
      <Table className="tabular-nums">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {header("name", "名稱", "left")}
            {header("changePct", "漲跌幅")}
            {header("advancers", "上漲／下跌家數")}
            {lens === "pro" ? (
              header("turnover", "成交值")
            ) : (
              <TableHead className="text-muted-foreground">說明</TableHead>
            )}
            {header("change1mPct", "近一月")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name} data-state={selected === row.name ? "selected" : undefined}>
              <TableCell>
                <button
                  type="button"
                  aria-current={selected === row.name ? "true" : undefined}
                  onClick={() => onSelect(row.name)}
                  className="rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {row.name}
                </button>
              </TableCell>
              <TableCell className={cn("text-right", shownTrendClass(row.changePct))}>
                {formatPct(row.changePct)}
              </TableCell>
              <TableCell className="text-right">{`${row.advancers}／${row.decliners}`}</TableCell>
              {lens === "pro" ? (
                <TableCell className="text-right">{`${turnoverFormat.format(row.turnover)} 億`}</TableCell>
              ) : (
                <TableCell className="whitespace-normal text-muted-foreground">
                  {plainChangeLine(row)}
                </TableCell>
              )}
              <TableCell
                className={cn(
                  "text-right",
                  row.change1mPct === null
                    ? "text-muted-foreground"
                    : shownTrendClass(row.change1mPct),
                )}
              >
                {formatMonth(row.change1mPct)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortHeader({
  label,
  align,
  active,
  dir,
  onSort,
}: {
  label: string;
  align: "left" | "right";
  active: boolean;
  dir: SortDir;
  onSort(): void;
}) {
  const Icon = !active ? ChevronsUpDownIcon : dir === "desc" ? ArrowDownIcon : ArrowUpIcon;
  return (
    <TableHead
      aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"}
      className={align === "right" ? "text-right" : undefined}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon aria-hidden className="size-3.5" />
      </button>
    </TableHead>
  );
}
