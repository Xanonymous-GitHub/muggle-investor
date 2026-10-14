import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "../../../test/helpers/test-db";
import {
  getCorporateActions,
  getPriceBars,
  latestPriceDate,
  upsertCorporateActions,
  upsertPriceBars,
} from "./prices";

const bar = (date: string, close: number, symbol = "0050") => ({
  symbol,
  date,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 12_345_678_901,
  turnover: null,
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
