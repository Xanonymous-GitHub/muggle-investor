import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import type { RateLimiter } from "@/lib/rate-limiter";
import { createTwseClient } from "./client";

const fixture = readFileSync("test/fixtures/twse/holiday-schedule.json", "utf8");

const setup = (body: string = fixture, status = 200) => {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const acquire = vi.fn(async () => {});
  const limiter: RateLimiter = { acquire, tryAcquire: () => true };
  const client = createTwseClient({ limiter, fetchImpl, sleep: async () => {} });
  return { client, urls, acquire };
};

describe("twse client", () => {
  it("requests the holiday schedule once through the limiter", async () => {
    const { client, urls, acquire } = setup();
    await client.fetchHolidaySchedule();
    expect(urls).toEqual(["https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule"]);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("takes one limiter token per upstream attempt, retries included", async () => {
    const { client, urls, acquire } = setup("boom", 503);
    await expect(client.fetchHolidaySchedule()).rejects.toBeInstanceOf(HttpError);
    expect(urls).toHaveLength(4);
    expect(acquire).toHaveBeenCalledTimes(4);
  });

  it("converts ROC dates and classifies trading days by name", async () => {
    const { client } = setup();
    const days = await client.fetchHolidaySchedule();
    const on = (date: string) => days.find((d) => d.date === date);

    expect(on("2026-01-01")).toMatchObject({ name: "中華民國開國紀念日", isTradingDay: false });
    // 「國曆新年開始交易日」 is the first trading day of the year, not a holiday.
    expect(on("2026-01-02")).toMatchObject({ name: "國曆新年開始交易日", isTradingDay: true });
    // Last trading day before Lunar New Year still trades.
    expect(on("2026-02-11")?.isTradingDay).toBe(true);
    // Settlement-only day: the market is closed.
    expect(on("2026-02-12")).toMatchObject({
      name: "市場無交易，僅辦理結算交割作業",
      isTradingDay: false,
    });
    expect(on("2026-10-09")?.isTradingDay).toBe(false);
    expect(days).toHaveLength(27);
  });

  it("rejects a response that is not a holiday list", async () => {
    const { client } = setup('{"error":"oops"}');
    await expect(client.fetchHolidaySchedule()).rejects.toThrow(/holiday/i);
  });
});
