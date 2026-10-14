import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { listEtfUniverse, upsertEtfUniverse } from "@/db/repositories/etf-universe";
import type { FinMindClient, StockInfo } from "@/sources/finmind";
import { createTestDb } from "../../test/helpers/test-db";
import { refreshEtfUniverse } from "./etf-universe";

const info = (symbol: string, name: string, industry = "ETF"): StockInfo => ({
  symbol,
  name,
  industry,
  market: "twse",
});

const LISTINGS = [info("0050", "元大台灣50"), info("2330", "台積電", "半導體業")];
const NOW = new Date("2026-10-08T07:00:00.000Z");
const DAY_MS = 86_400_000;

function fakeFinMind(fetchStockInfo: FinMindClient["fetchStockInfo"]) {
  return {
    fetchStockInfo: vi.fn(fetchStockInfo),
    fetchPrices: vi.fn<FinMindClient["fetchPrices"]>(async () => []),
    fetchCorporateActions: vi.fn<FinMindClient["fetchCorporateActions"]>(async () => []),
  };
}

describe("refreshEtfUniverse", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("fetches the listings and stores the ETFs stamped with `now`", async () => {
    const finmind = fakeFinMind(async () => LISTINGS);

    const outcome = await refreshEtfUniverse({ db, finmind, now: NOW });

    expect(outcome).toEqual({ status: "done", detail: "2 listings" });
    expect(finmind.fetchStockInfo).toHaveBeenCalledTimes(1);
    const rows = await listEtfUniverse(db);
    expect(rows.map((r) => [r.symbol, r.updatedAt])).toEqual([["0050", NOW]]);
  });

  it("skips while the newest row is younger than 7 days, then refreshes again", async () => {
    await upsertEtfUniverse(db, LISTINGS, NOW);
    const finmind = fakeFinMind(async () => LISTINGS);

    const soon = await refreshEtfUniverse({
      db,
      finmind,
      now: new Date(NOW.getTime() + 7 * DAY_MS - 1),
    });
    expect(soon.status).toBe("skipped");
    expect(finmind.fetchStockInfo).not.toHaveBeenCalled();

    const later = new Date(NOW.getTime() + 7 * DAY_MS);
    const due = await refreshEtfUniverse({ db, finmind, now: later });
    expect(due.status).toBe("done");
    expect((await listEtfUniverse(db))[0]?.updatedAt).toEqual(later);
  });

  it("returns failed instead of throwing when FinMind fails, keeping stored rows", async () => {
    await upsertEtfUniverse(db, LISTINGS, new Date(NOW.getTime() - 30 * DAY_MS));
    const finmind = fakeFinMind(async () => {
      throw new Error("FinMind TaiwanStockInfo failed with status 402: quota");
    });

    const outcome = await refreshEtfUniverse({ db, finmind, now: NOW });

    expect(outcome).toEqual({
      status: "failed",
      detail: "FinMind TaiwanStockInfo failed with status 402: quota",
    });
    expect(await listEtfUniverse(db)).toHaveLength(1);
  });

  it("returns failed for an empty listing", async () => {
    const outcome = await refreshEtfUniverse({
      db,
      finmind: fakeFinMind(async () => []),
      now: NOW,
    });

    expect(outcome.status).toBe("failed");
    expect(await listEtfUniverse(db)).toEqual([]);
  });
});
