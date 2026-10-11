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

  it("replaces the whole calendar rather than appending", async () => {
    await replaceHolidays(db, [{ date: "2026-02-16", name: "春節", isTradingDay: false }]);
    await replaceHolidays(db, [{ date: "2026-04-03", name: "兒童節", isTradingDay: false }]);
    expect(await getHolidays(db, 2026)).toEqual([
      { date: "2026-04-03", name: "兒童節", isTradingDay: false },
    ]);
  });

  it("clears the calendar when given an empty list", async () => {
    await replaceHolidays(db, [{ date: "2026-02-16", name: "春節", isTradingDay: false }]);
    await replaceHolidays(db, []);
    expect(await getHolidays(db, 2026)).toEqual([]);
  });
});
