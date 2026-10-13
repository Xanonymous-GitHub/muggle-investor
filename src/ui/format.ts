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

// Always an explicit sign for non-zero values, so colour is never the only signal. A value that
// rounds to zero prints as plain "0.00" rather than "-0.00".
export function formatSigned(n: number, digits = 2): string {
  const fixed = Math.abs(n).toFixed(digits);
  if (Number(fixed) === 0) return (0).toFixed(digits);
  return `${n < 0 ? "-" : "+"}${fixed}`;
}

export function formatPct(n: number, digits = 2): string {
  return `${formatSigned(n, digits)}%`;
}

export function formatYi(n: number): string {
  return `${formatSigned(n)} 億`;
}

export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

// Weekday is computed in UTC from the YYYY-MM-DD string, so the viewer's time zone never shifts it.
export function formatDataDate(tradeDate: string): string {
  const weekday = WEEKDAYS[new Date(`${tradeDate}T00:00:00Z`).getUTCDay()];
  return `${tradeDate}（${weekday}）`;
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
