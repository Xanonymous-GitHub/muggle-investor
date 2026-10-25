import type { Chunk } from "./ask-harness";

/** Synthetic Traditional Chinese content: nothing here is market data. */

export const QUESTION = "今天大盤跌了，我定期定額買的 0050 要不要先停掉？";

export const ANSWER = [
  "**結論**",
  "今天大盤下跌 1.2%，但這只是單日波動，不需要因此停掉定期定額。",
  "",
  "**依據**",
  "加權指數收 21,345.67 點，成交量 3,210 億元，和近五日均量相近，沒有明顯放大。",
  "[證交所收盤行情](https://www.twse.com.tw/zh/trading/exchange/MI_INDEX.html)也顯示跌幅集中在電子權值股。",
  "",
  "**情境**",
  "- 若量能回溫，族群輪動會變快。",
  "- 若量縮，維持區間整理。",
  "",
  "**對你的意義**",
  "你的投資期間比較長，短期波動不需要改變原本的計畫。",
  "",
  "**建議**",
  "維持原本的定期定額，不追高、不殺低。",
  "",
  "**信心程度**",
  "中等，因為這只是一天的資料。",
].join("\n");

export const LONG_ANSWER = [ANSWER, ANSWER, ANSWER].join("\n\n");

const slices = (text: string, size = 24): string[] => {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
};

export const start: Chunk = { type: "start" };
export const textStart: Chunk = { type: "text-start", id: "t1" };
export const textEnd: Chunk = { type: "text-end", id: "t1" };
export const finish: Chunk = { type: "finish", finishReason: "stop" };

export const deltas = (text: string, size?: number): Chunk[] =>
  slices(text, size).map((delta) => ({ type: "text-delta", id: "t1", delta }));

export const toolStart = (id: string, name: string): Chunk[] => [
  { type: "tool-input-start", toolCallId: id, toolName: name },
  { type: "tool-input-available", toolCallId: id, toolName: name, input: {} },
];
export const toolOk = (id: string): Chunk => ({
  type: "tool-output-available",
  toolCallId: id,
  output: { ok: true },
});
export const toolError = (id: string): Chunk => ({
  type: "tool-output-error",
  toolCallId: id,
  errorText: "failed",
});

export const notice = (kind: string, text: string): Chunk => ({
  type: "data-notice",
  data: { kind, text },
});

export const verification = (data: Record<string, unknown> = {}): Chunk => ({
  type: "data-verification",
  data: { unsupported: [], checked: true, ...data },
});

/** One source record as the server sends it in `evidence.records`. */
export const record = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "s1",
  tool: "getMarketToday",
  kind: "internal",
  retrievedAt: "2026-10-24T08:00:00.000Z",
  dataDate: "2026-10-24",
  asOf: null,
  session: "closed",
  urls: [],
  truncated: false,
  failed: false,
  warnings: [],
  ...patch,
});

/** An `evidence` object built from records, the way the ledger summarises them. */
export const evidenceOf = (records: Record<string, unknown>[]): Record<string, unknown> => ({
  sources: records.filter((r) => !r.failed).length,
  failed: [...new Set(records.filter((r) => r.failed).map((r) => r.tool))],
  truncated: records.some((r) => r.truncated),
  warnings: [...new Set(records.flatMap((r) => r.warnings as string[]))],
  records,
  omitted: 0,
});

/** The whole of a finished, checked answer, as the server sends it. */
export const completeAnswer = (text = ANSWER, extra: Record<string, unknown> = {}): Chunk[] => [
  start,
  ...toolStart("c1", "getMarketToday"),
  toolOk("c1"),
  textStart,
  ...deltas(text, 60),
  textEnd,
  verification({
    evidence: evidenceOf([
      record(),
      record({
        id: "s2",
        tool: "getSectorBoard",
        dataDate: "2026-10-24",
        session: "closed",
        urls: ["www.twse.com.tw/zh/trading/exchange/MI_INDEX.html"],
      }),
    ]),
    ...extra,
  }),
  finish,
];
