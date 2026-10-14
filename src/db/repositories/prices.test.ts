import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "../../../test/helpers/test-db";
import {
  earliestPriceDate,
  getCorporateActions,
  getPriceBars,
  getPriceStats,
  latestPriceDate,
  upsertCorporateActions,
  upsertPriceBars,
} from "./prices";

const bar = (date: string, close: number, symbol = "0050", turnover: number | null = null) => ({
  symbol,
  date,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 12_345_678_901,
  turnover,
});

describe("prices repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("upserting a bar twice keeps one row with the new close", async () => {
    await upsertPriceBars(db, [bar("2026-10-07", 100)]);
    await upsertPriceBars(db, [bar("2026-10-07", 101.5)]);
    const rows = await getPriceBars(db, "0050", "2026-10-01", "2026-10-31");
    expect(rows).toEqual([bar("2026-10-07", 101.5)]);
  });

  it("round-trips turnover and a re-upsert updates it", async () => {
    await upsertPriceBars(db, [bar("2026-10-07", 100, "0050", 1_234_567_890.5)]);
    expect(await getPriceBars(db, "0050", "2026-10-01", "2026-10-31")).toEqual([
      bar("2026-10-07", 100, "0050", 1_234_567_890.5),
    ]);
    await upsertPriceBars(db, [bar("2026-10-07", 100, "0050", 2_000_000_000)]);
    const rows = await getPriceBars(db, "0050", "2026-10-01", "2026-10-31");
    expect(rows.map((r) => r.turnover)).toEqual([2_000_000_000]);
  });

  it("a re-upsert without turnover keeps the stored turnover", async () => {
    await upsertPriceBars(db, [bar("2026-10-07", 100, "0050", 1_500_000_000)]);
    await upsertPriceBars(db, [bar("2026-10-07", 101, "0050", null)]);
    expect(await getPriceBars(db, "0050", "2026-10-01", "2026-10-31")).toEqual([
      bar("2026-10-07", 101, "0050", 1_500_000_000),
    ]);
  });

  it("is a no-op for an empty list", async () => {
    await expect(upsertPriceBars(db, [])).resolves.toBeUndefined();
    await expect(upsertCorporateActions(db, [])).resolves.toBeUndefined();
  });

  it("latestPriceDate returns the max date, or null for an unknown symbol", async () => {
    await upsertPriceBars(db, [
      bar("2026-10-06", 99),
      bar("2026-10-08", 101),
      bar("2026-10-07", 100),
    ]);
    expect(await latestPriceDate(db, "0050")).toBe("2026-10-08");
    expect(await latestPriceDate(db, "2330")).toBeNull();
  });

  it("getPriceBars returns an inclusive range ascending, for one symbol", async () => {
    await upsertPriceBars(db, [
      bar("2026-10-08", 101),
      bar("2026-10-06", 99),
      bar("2026-10-07", 100),
      bar("2026-10-07", 500, "2330"),
    ]);
    const rows = await getPriceBars(db, "0050", "2026-10-07", "2026-10-08");
    expect(rows.map((r) => r.date)).toEqual(["2026-10-07", "2026-10-08"]);
  });

  it("earliestPriceDate returns the min date, or null for an unknown symbol", async () => {
    await upsertPriceBars(db, [
      bar("2026-10-08", 101),
      bar("2026-10-06", 99),
      bar("2026-10-01", 500, "2330"),
    ]);
    expect(await earliestPriceDate(db, "0050")).toBe("2026-10-06");
    expect(await earliestPriceDate(db, "9999")).toBeNull();
  });

  describe("getPriceStats", () => {
    it("is null for a symbol with no bars", async () => {
      expect(await getPriceStats(db, "0050")).toBeNull();
    });

    it("falls back to close * volume for null turnover, ascending by date", async () => {
      await upsertPriceBars(db, [
        { ...bar("2026-10-08", 102, "0050", 5_000), volume: 10 },
        { ...bar("2026-10-06", 100, "0050", null), volume: 10 },
        { ...bar("2026-10-07", 101, "0050", 7_000), volume: 10 },
        bar("2026-10-07", 900, "2330", 1),
      ]);
      expect(await getPriceStats(db, "0050")).toEqual({
        firstDate: "2026-10-06",
        lastDate: "2026-10-08",
        barCount: 3,
        recentTurnovers: [1000, 7000, 5000],
      });
    });

    it("keeps only the most recent 120 turnovers but counts every bar", async () => {
      const start = Date.UTC(2026, 0, 1);
      const day = (i: number) => new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      await upsertPriceBars(
        db,
        Array.from({ length: 130 }, (_, i) => bar(day(i), 100, "0050", 1000 + i)),
      );
      const stats = await getPriceStats(db, "0050");
      expect(stats?.barCount).toBe(130);
      expect(stats?.firstDate).toBe(day(0));
      expect(stats?.lastDate).toBe(day(129));
      expect(stats?.recentTurnovers).toHaveLength(120);
      expect(stats?.recentTurnovers[0]).toBe(1010);
      expect(stats?.recentTurnovers[119]).toBe(1129);
      expect((await getPriceStats(db, "0050", 3))?.recentTurnovers).toEqual([1127, 1128, 1129]);
    });
  });

  it("upserts corporate actions by (symbol, exDate, kind), preserving null cashDividend", async () => {
    await upsertCorporateActions(db, [
      {
        symbol: "0050",
        exDate: "2026-07-20",
        kind: "dividend",
        beforePrice: 190,
        afterPrice: 187,
        cashDividend: 3,
      },
      {
        symbol: "0050",
        exDate: "2025-06-11",
        kind: "split",
        beforePrice: 180,
        afterPrice: 45,
        cashDividend: null,
      },
    ]);
    await upsertCorporateActions(db, [
      {
        symbol: "0050",
        exDate: "2026-07-20",
        kind: "dividend",
        beforePrice: 190,
        afterPrice: 186.5,
        cashDividend: 3.5,
      },
    ]);
    const rows = await getCorporateActions(db, "0050");
    expect(rows).toEqual([
      {
        symbol: "0050",
        exDate: "2025-06-11",
        kind: "split",
        beforePrice: 180,
        afterPrice: 45,
        cashDividend: null,
      },
      {
        symbol: "0050",
        exDate: "2026-07-20",
        kind: "dividend",
        beforePrice: 190,
        afterPrice: 186.5,
        cashDividend: 3.5,
      },
    ]);
  });
});
