import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import type { StockInfo } from "@/sources/finmind";
import { createTestDb } from "../../../test/helpers/test-db";
import { listEtfUniverse, markHistoryChecked, upsertEtfUniverse } from "./etf-universe";

const info = (symbol: string, name: string, industry = "ETF", market = "twse"): StockInfo => ({
  symbol,
  name,
  industry,
  market,
});

describe("etf universe repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("is a no-op for an empty list", async () => {
    await expect(upsertEtfUniverse(db, [])).resolves.toBeUndefined();
    expect(await listEtfUniverse(db)).toEqual([]);
  });

  it("keeps only rows whose industry contains ETF", async () => {
    await upsertEtfUniverse(db, [
      info("0050", "元大台灣50"),
      info("2330", "台積電", "半導體業"),
      info("00679B", "元大美債20年", "ETF債券型", "tpex"),
      info("1101", "台泥", "水泥工業"),
    ]);
    const rows = await listEtfUniverse(db);
    expect(rows.map((r) => r.symbol).sort()).toEqual(["0050", "00679B"]);
    const etf = rows.find((r) => r.symbol === "00679B");
    expect(etf).toMatchObject({
      name: "元大美債20年",
      market: "tpex",
      industry: "ETF債券型",
      historyCheckedAt: null,
    });
    expect(etf?.updatedAt).toBeInstanceOf(Date);
  });

  it("updates a renamed symbol and keeps a previously set history_checked_at", async () => {
    await upsertEtfUniverse(db, [info("0050", "元大台灣50")]);
    const checkedAt = new Date("2026-10-10T08:00:00.000Z");
    await markHistoryChecked(db, "0050", checkedAt);
    await upsertEtfUniverse(db, [info("0050", "元大台灣卓越50")]);
    const [row] = await listEtfUniverse(db);
    expect(row?.name).toBe("元大台灣卓越50");
    expect(row?.historyCheckedAt).toEqual(checkedAt);
  });

  it("markHistoryChecked sets the timestamp for that symbol only", async () => {
    await upsertEtfUniverse(db, [info("0050", "元大台灣50"), info("0056", "元大高股息")]);
    const at = new Date("2026-10-14T00:00:00.000Z");
    await markHistoryChecked(db, "0056", at);
    const rows = await listEtfUniverse(db);
    expect(rows.find((r) => r.symbol === "0056")?.historyCheckedAt).toEqual(at);
    expect(rows.find((r) => r.symbol === "0050")?.historyCheckedAt).toBeNull();
  });

  it("stamps updated_at with an explicit time on insert and on refresh", async () => {
    const first = new Date("2026-10-01T00:00:00.000Z");
    const second = new Date("2026-10-09T00:00:00.000Z");
    await upsertEtfUniverse(db, [info("0050", "元大台灣50")], first);
    expect((await listEtfUniverse(db))[0]?.updatedAt).toEqual(first);
    await upsertEtfUniverse(db, [info("0050", "元大台灣50")], second);
    expect((await listEtfUniverse(db))[0]?.updatedAt).toEqual(second);
  });

  it("lists ascending by symbol", async () => {
    await upsertEtfUniverse(db, [info("0056", "b"), info("0050", "a")]);
    expect((await listEtfUniverse(db)).map((r) => r.symbol)).toEqual(["0050", "0056"]);
  });
});
