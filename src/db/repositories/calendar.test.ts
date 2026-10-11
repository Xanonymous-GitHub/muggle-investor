import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "../../../test/helpers/test-db";
import { getHolidays, replaceHolidays } from "./calendar";

describe("calendar repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("round-trips holidays with isTradingDay, filtered by year, ascending", async () => {
    await replaceHolidays(db, [
      { date: "2026-02-16", name: "春節", isTradingDay: false },
      { date: "2026-01-02", name: "國曆新年開始交易日", isTradingDay: true },
      { date: "2025-12-31", name: "市場無交易，僅辦理結算交割作業", isTradingDay: false },
    ]);
    expect(await getHolidays(db, 2026)).toEqual([
      { date: "2026-01-02", name: "國曆新年開始交易日", isTradingDay: true },
      { date: "2026-02-16", name: "春節", isTradingDay: false },
    ]);
    expect(await getHolidays(db, 2027)).toEqual([]);
  });

  it("replaces a year's calendar rather than appending", async () => {
    await replaceHolidays(db, [{ date: "2026-02-16", name: "春節", isTradingDay: false }]);
    await replaceHolidays(db, [{ date: "2026-04-03", name: "兒童節", isTradingDay: false }]);
    expect(await getHolidays(db, 2026)).toEqual([
      { date: "2026-04-03", name: "兒童節", isTradingDay: false },
    ]);
  });

  it("refuses an empty list and keeps the stored calendar", async () => {
    await replaceHolidays(db, [{ date: "2026-02-16", name: "春節", isTradingDay: false }]);
    await expect(replaceHolidays(db, [])).rejects.toThrow(/empty/);
    expect(await getHolidays(db, 2026)).toEqual([
      { date: "2026-02-16", name: "春節", isTradingDay: false },
    ]);
  });

  it("only replaces the years present in the input", async () => {
    await replaceHolidays(db, [
      { date: "2025-12-31", name: "市場無交易，僅辦理結算交割作業", isTradingDay: false },
      { date: "2026-02-16", name: "春節", isTradingDay: false },
    ]);
    await replaceHolidays(db, [{ date: "2026-04-03", name: "兒童節", isTradingDay: false }]);
    expect(await getHolidays(db, 2025)).toEqual([
      { date: "2025-12-31", name: "市場無交易，僅辦理結算交割作業", isTradingDay: false },
    ]);
    expect(await getHolidays(db, 2026)).toEqual([
      { date: "2026-04-03", name: "兒童節", isTradingDay: false },
    ]);
  });
});
