import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import type { RateLimiter } from "@/lib/rate-limiter";
import { createFinMindClient } from "./client";

const TOKEN = "fm-secret-token-xyz";
const fixture = (name: string) => readFileSync(`test/fixtures/finmind/${name}`, "utf8");

const json = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

const setup = (respond: (url: URL) => Response, token?: string) => {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return respond(url);
  }) as unknown as typeof fetch;
  const acquire = vi.fn(async () => {});
  const limiter: RateLimiter = { acquire, tryAcquire: () => true };
  const client = createFinMindClient({
    ...(token !== undefined && { token }),
    limiter,
    fetchImpl,
    sleep: async () => {},
  });
  return { client, calls, acquire };
};

const byDataset = (url: URL): Response => {
  switch (url.searchParams.get("dataset")) {
    case "TaiwanStockPrice":
      return json(fixture("price-0050-2026-09.json"));
    case "TaiwanStockDividendResult":
      return json(fixture("dividend-result-0050.json"));
    case "TaiwanStockSplitPrice":
      return json(fixture("split-0050.json"));
    case "TaiwanStockInfo":
      return json(fixture("stockinfo-sample.json"));
    default:
      return json('{"msg":"unknown dataset","status":400,"data":[]}');
  }
};

describe("finmind client: prices", () => {
  it("maps TaiwanStockPrice rows to PriceBar", async () => {
    const { client, calls, acquire } = setup(byDataset);
    const bars = await client.fetchPrices("0050", "2026-09-01", "2026-09-30");
    expect(bars[0]).toEqual({
      symbol: "0050",
      date: "2026-09-01",
      open: 106.5,
      high: 108.7,
      low: 106.5,
      close: 108.45,
      volume: 111066980,
      turnover: 12012866945,
    });
    expect(bars.length).toBeGreaterThan(10);
    expect(calls).toHaveLength(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    const { url } = calls[0] as (typeof calls)[number];
    expect(`${url.origin}${url.pathname}`).toBe("https://api.finmindtrade.com/api/v4/data");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dataset: "TaiwanStockPrice",
      data_id: "0050",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
    });
  });

  it("sends no Authorization header without a token", async () => {
    const { client, calls } = setup(byDataset);
    await client.fetchPrices("0050", "2026-09-01", "2026-09-30");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("sends the token as a Bearer header and never in the URL", async () => {
    const { client, calls } = setup(byDataset, TOKEN);
    await client.fetchPrices("0050", "2026-09-01", "2026-09-30");
    const call = calls[0] as (typeof calls)[number];
    expect(new Headers(call.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(call.url.href).not.toContain(TOKEN);
  });

  it("throws naming the dataset and status when the body status is not 200", async () => {
    const { client } = setup(() =>
      json('{"msg":"Requests reach the upper limit","status":402,"data":[]}'),
    );
    const error = await client.fetchPrices("0050", "2026-09-01", "2026-09-30").catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("TaiwanStockPrice");
    expect(error.message).toContain("402");
  });

  it("does not leak the token through an upstream message echoing it", async () => {
    const { client } = setup(
      () => json(`{"msg":"bad token ${TOKEN}","status":400,"data":[]}`),
      TOKEN,
    );
    const error = await client.fetchPrices("0050", "2026-09-01", "2026-09-30").catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(TOKEN);
  });

  it("takes one limiter token per upstream attempt, retries included", async () => {
    const { client, calls, acquire } = setup(() => new Response("boom", { status: 500 }));
    const error = await client.fetchPrices("0050", "2026-09-01", "2026-09-30").catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(4);
    expect(acquire).toHaveBeenCalledTimes(4);
  });

  it("does not leak the token on HTTP failures", async () => {
    const { client } = setup(() => new Response("nope", { status: 403 }), TOKEN);
    const error = await client.fetchPrices("0050", "2026-09-01", "2026-09-30").catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.message).not.toContain(TOKEN);
  });

  it("gives a null turnover when Trading_money is missing", async () => {
    const row = {
      date: "2026-09-01",
      stock_id: "0050",
      Trading_Volume: 10,
      open: 1,
      max: 2,
      min: 1,
      close: 2,
    };
    const { client } = setup(() =>
      json(JSON.stringify({ msg: "success", status: 200, data: [row] })),
    );
    const bars = await client.fetchPrices("0050", "2026-09-01", "2026-09-01");
    expect(bars[0]?.turnover).toBeNull();
  });

  it("rejects a malformed row instead of returning partial data", async () => {
    const { client } = setup(() =>
      json('{"msg":"success","status":200,"data":[{"date":"2026-09-01","stock_id":"0050"}]}'),
    );
    await expect(client.fetchPrices("0050", "2026-09-01", "2026-09-30")).rejects.toThrow(
      /TaiwanStockPrice/,
    );
  });
});

describe("finmind client: corporate actions", () => {
  it("merges dividends and splits sorted by exDate", async () => {
    const { client, calls, acquire } = setup(byDataset);
    const actions = await client.fetchCorporateActions("0050", "2025-01-01");

    expect(actions).toContainEqual({
      symbol: "0050",
      exDate: "2025-06-18",
      kind: "split",
      beforePrice: 188.65,
      afterPrice: 47.16,
      cashDividend: null,
    });
    expect(actions).toContainEqual({
      symbol: "0050",
      exDate: "2025-07-21",
      kind: "dividend",
      beforePrice: 51.45,
      afterPrice: 51.09,
      cashDividend: 0.36,
    });
    const dates = actions.map((a) => a.exDate);
    expect(dates).toEqual([...dates].sort());
    expect(dates.indexOf("2025-06-18")).toBeLessThan(dates.indexOf("2025-07-21"));

    expect(calls.map((c) => c.url.searchParams.get("dataset")).sort()).toEqual([
      "TaiwanStockDividendResult",
      "TaiwanStockSplitPrice",
    ]);
    expect(calls.every((c) => c.url.searchParams.get("start_date") === "2025-01-01")).toBe(true);
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("keeps stock dividends as dividend actions with null cashDividend", async () => {
    const body = JSON.stringify({
      msg: "success",
      status: 200,
      data: [
        {
          date: "2025-08-01",
          stock_id: "0050",
          before_price: 100,
          after_price: 90,
          stock_and_cache_dividend: 1,
          stock_or_cache_dividend: "權",
          max_price: 110,
          min_price: 81,
          open_price: 90,
          reference_price: 90,
        },
      ],
    });
    const { client } = setup((url) =>
      url.searchParams.get("dataset") === "TaiwanStockDividendResult"
        ? json(body)
        : json('{"msg":"success","status":200,"data":[]}'),
    );
    expect(await client.fetchCorporateActions("0050", "2025-01-01")).toEqual([
      {
        symbol: "0050",
        exDate: "2025-08-01",
        kind: "dividend",
        beforePrice: 100,
        afterPrice: 90,
        cashDividend: null,
      },
    ]);
  });

  it("marks bond ETF distributions (除息) as cash dividends", async () => {
    const { client } = setup((url) =>
      url.searchParams.get("dataset") === "TaiwanStockDividendResult"
        ? json(fixture("dividend-result-00679B.json"))
        : json('{"msg":"success","status":200,"data":[]}'),
    );
    const actions = await client.fetchCorporateActions("00679B", "2017-01-01");
    expect(actions[0]).toEqual({
      symbol: "00679B",
      exDate: "2017-08-23",
      kind: "dividend",
      beforePrice: 39.99,
      afterPrice: 39.53,
      cashDividend: 0.46,
    });
    expect(actions.every((a) => a.cashDividend !== null)).toBe(true);
  });

  it("throws when either dataset reports a non-200 status", async () => {
    const { client } = setup((url) =>
      url.searchParams.get("dataset") === "TaiwanStockSplitPrice"
        ? json('{"msg":"fail","status":500,"data":[]}')
        : byDataset(url),
    );
    const error = await client.fetchCorporateActions("0050", "2025-01-01").catch((e) => e);
    expect(error.message).toContain("TaiwanStockSplitPrice");
    expect(error.message).toContain("500");
  });
});

describe("finmind client: instrument list", () => {
  it("returns one entry per symbol, keeping the row with the latest date", async () => {
    const { client, calls, acquire } = setup(byDataset);
    const infos = await client.fetchStockInfo();

    expect(infos.filter((i) => i.symbol === "00679B")).toEqual([
      { symbol: "00679B", name: "元大美債20年", industry: "上櫃ETF", market: "tpex" },
    ]);
    expect(infos.find((i) => i.symbol === "0050")).toEqual({
      symbol: "0050",
      name: "元大台灣50",
      industry: "ETF",
      market: "twse",
    });
    expect(infos.filter((i) => i.symbol === "2330")).toHaveLength(1);
    expect(infos.map((i) => i.symbol).sort()).toEqual(["0050", "00679B", "2330"]);

    expect(calls).toHaveLength(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    const { url } = calls[0] as (typeof calls)[number];
    expect(Object.fromEntries(url.searchParams)).toEqual({ dataset: "TaiwanStockInfo" });
  });

  it("throws naming the dataset when the body status is not 200", async () => {
    const { client } = setup(() => json('{"msg":"fail","status":500,"data":[]}'));
    const error = await client.fetchStockInfo().catch((e) => e);
    expect(error.message).toContain("TaiwanStockInfo");
    expect(error.message).toContain("500");
  });
});
