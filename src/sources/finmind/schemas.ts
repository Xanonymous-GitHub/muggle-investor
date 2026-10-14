import { z } from "zod";

export type PriceBar = {
  symbol: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Traded value in TWD (FinMind Trading_money); null when the row does not carry it. */
  turnover: number | null;
};

/** One listed instrument from TaiwanStockInfo. */
export type StockInfo = {
  symbol: string;
  name: string;
  /** FinMind industry_category of the latest row. */
  industry: string;
  /** FinMind `type` (e.g. twse, tpex). */
  market: string;
};

export type CorporateAction = {
  symbol: string;
  /** ISO ex-date (YYYY-MM-DD). */
  exDate: string;
  kind: "dividend" | "split";
  beforePrice: number;
  afterPrice: number;
  /** Cash per share; null for splits and for stock dividends/rights, whose price effect is still carried by before/after. */
  cashDividend: number | null;
};

/** FinMind envelope. `status` is the real result code; HTTP can be 200 while it is not. */
export const finMindEnvelopeSchema = z.object({
  msg: z.string(),
  status: z.number(),
  data: z.array(z.unknown()),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const priceRowSchema = z.object({
  date: isoDate,
  stock_id: z.string(),
  open: z.number(),
  max: z.number(),
  min: z.number(),
  close: z.number(),
  Trading_Volume: z.number(),
  Trading_money: z.number().optional(),
});

export const dividendResultRowSchema = z.object({
  date: isoDate,
  stock_id: z.string(),
  before_price: z.number(),
  after_price: z.number(),
  stock_and_cache_dividend: z.number(),
  stock_or_cache_dividend: z.string(),
});

export const splitRowSchema = z.object({
  date: isoDate,
  stock_id: z.string(),
  before_price: z.number(),
  after_price: z.number(),
});

export const stockInfoRowSchema = z.object({
  date: isoDate,
  stock_id: z.string(),
  stock_name: z.string(),
  industry_category: z.string(),
  type: z.string(),
});
