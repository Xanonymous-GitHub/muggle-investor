import { formatDataDate } from "@/ui/format";

/** Shown when a refresh failed and the screen is showing the copy saved for `dataDate`. */
export function StaleNotice({ dataDate }: { dataDate: string }) {
  return (
    <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
      {`無法更新，顯示的是 ${formatDataDate(dataDate)} 的資料。`}
    </p>
  );
}
