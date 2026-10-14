export type Trend = "up" | "down" | "flat";

export function trendOf(n: number): Trend {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

// Red is up and green is down (Taiwan convention); flat stays neutral.
export function trendClass(t: Trend): string {
  if (t === "up") return "text-up";
  if (t === "down") return "text-down";
  return "text-muted-foreground";
}

/** Shown in place of a number that is not finite (a malformed or missing value). */
export const NO_VALUE = "—";

// Always an explicit sign for non-zero values, so colour is never the only signal. A value that
// rounds to zero prints as plain "0.00" rather than "-0.00".
export function formatSigned(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return NO_VALUE;
  const fixed = Math.abs(n).toFixed(digits);
  if (Number(fixed) === 0) return (0).toFixed(digits);
  return `${n < 0 ? "-" : "+"}${fixed}`;
}

export function formatPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return NO_VALUE;
  return `${formatSigned(n, digits)}%`;
}

export function formatYi(n: number): string {
  if (!Number.isFinite(n)) return NO_VALUE;
  return `${formatSigned(n)} 億`;
}

export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return NO_VALUE;
  return n.toLocaleString("en-US");
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

// Weekday is computed in UTC from the YYYY-MM-DD string, so the viewer's time zone never shifts it.
// A string that is not such a date is shown as it is, without a weekday.
export function formatDataDate(tradeDate: string): string {
  const weekday = /^\d{4}-\d{2}-\d{2}$/.test(tradeDate)
    ? WEEKDAYS[new Date(`${tradeDate}T00:00:00Z`).getUTCDay()]
    : undefined;
  return weekday === undefined ? tradeDate : `${tradeDate}（${weekday}）`;
}

export function formatDataLine(meta: {
  tradeDate: string;
  session: "closed" | "intraday" | "unknown";
  asOf: string | null;
}): string {
  const date = `資料日期 ${formatDataDate(meta.tradeDate)}`;
  if (meta.session === "closed") return `${date}盤後`;
  if (meta.session === "intraday") return meta.asOf ? `${date}盤中 ${meta.asOf}` : `${date}盤中`;
  return date;
}
