import { z } from "zod";
import { fetchWithRetry } from "@/lib/http";
import type { RateLimiter, Sleep } from "@/lib/rate-limiter";
import {
  type CorporateAction,
  dividendResultRowSchema,
  finMindEnvelopeSchema,
  type PriceBar,
  priceRowSchema,
  splitRowSchema,
} from "./schemas";

export interface FinMindClient {
  /** Daily bars for [start, end], ISO dates. Dataset TaiwanStockPrice. */
  fetchPrices(symbol: string, start: string, end: string): Promise<PriceBar[]>;
  /** Dividends (TaiwanStockDividendResult) and splits (TaiwanStockSplitPrice) from `start`, merged and sorted by exDate. */
  fetchCorporateActions(symbol: string, start: string): Promise<CorporateAction[]>;
}

export type FinMindClientOptions = {
  /** Optional API token; sent only as an Authorization header, never in the URL. */
  token?: string;
  limiter: RateLimiter;
  fetchImpl?: typeof fetch;
  /** Backoff sleep between retries; injectable for tests. */
  sleep?: Sleep;
};

const BASE_URL = "https://api.finmindtrade.com/api/v4/data";
const CASH_DIVIDEND_MARK = "息";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const redactSecret = (text: string, secret: string | undefined): string =>
  secret ? text.split(secret).join("***") : text;

export function createFinMindClient({
  token,
  limiter,
  fetchImpl,
  sleep,
}: FinMindClientOptions): FinMindClient {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const redact = (text: string) => redactSecret(text, token);

  /** One upstream request: rate-limited, retried, envelope-checked and row-validated. */
  const fetchDataset = async <T>(
    dataset: string,
    params: Record<string, string>,
    rowSchema: z.ZodType<T>,
  ): Promise<T[]> => {
    const url = `${BASE_URL}?${new URLSearchParams({ dataset, ...params })}`;
    await limiter.acquire();
    const response = await fetchWithRetry(url, {
      ...(headers && { headers }),
      ...(fetchImpl && { fetchImpl }),
      ...(sleep && { sleep }),
    });

    let envelope: z.infer<typeof finMindEnvelopeSchema>;
    try {
      envelope = finMindEnvelopeSchema.parse(await response.json());
    } catch (error) {
      throw new Error(redact(`FinMind ${dataset}: malformed response (${errorMessage(error)})`));
    }
    if (envelope.status !== 200) {
      throw new Error(
        redact(`FinMind ${dataset} failed with status ${envelope.status}: ${envelope.msg}`),
      );
    }
    const rows = z.array(rowSchema).safeParse(envelope.data);
    if (!rows.success) {
      throw new Error(redact(`FinMind ${dataset}: unexpected row shape (${rows.error.message})`));
    }
    return rows.data;
  };

  return {
    async fetchPrices(symbol, start, end) {
      const rows = await fetchDataset(
        "TaiwanStockPrice",
        { data_id: symbol, start_date: start, end_date: end },
        priceRowSchema,
      );
      return rows.map((row) => ({
        symbol: row.stock_id,
        date: row.date,
        open: row.open,
        high: row.max,
        low: row.min,
        close: row.close,
        volume: row.Trading_Volume,
      }));
    },

    async fetchCorporateActions(symbol, start) {
      const params = { data_id: symbol, start_date: start };
      const [dividends, splits] = await Promise.all([
        fetchDataset("TaiwanStockDividendResult", params, dividendResultRowSchema),
        fetchDataset("TaiwanStockSplitPrice", params, splitRowSchema),
      ]);
      const actions: CorporateAction[] = [
        ...dividends.map(
          (row): CorporateAction => ({
            symbol: row.stock_id,
            exDate: row.date,
            kind: "dividend",
            beforePrice: row.before_price,
            afterPrice: row.after_price,
            cashDividend:
              row.stock_or_cache_dividend === CASH_DIVIDEND_MARK
                ? row.stock_and_cache_dividend
                : null,
          }),
        ),
        ...splits.map(
          (row): CorporateAction => ({
            symbol: row.stock_id,
            exDate: row.date,
            kind: "split",
            beforePrice: row.before_price,
            afterPrice: row.after_price,
            cashDividend: null,
          }),
        ),
      ];
      return actions.sort((a, b) => a.exDate.localeCompare(b.exDate));
    },
  };
}
