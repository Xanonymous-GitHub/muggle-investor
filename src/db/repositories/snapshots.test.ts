import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "../../../test/helpers/test-db";
import {
  hasSnapshot,
  latestSnapshot,
  listClosedSnapshots,
  type NewSnapshot,
  saveSnapshot,
} from "./snapshots";

function snap(overrides: Partial<NewSnapshot> = {}): NewSnapshot {
  return {
    kind: "digest",
    groupName: null,
    tradeDate: "2026-10-08",
    asOf: null,
    session: "closed",
    capturedAt: new Date("2026-10-08T06:00:00Z"),
    rawHtml: "<html></html>",
    parsed: { ok: true },
    parseError: null,
    parserVersion: 1,
    ...overrides,
  };
}

describe("snapshots repository", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("saves the same snapshot twice: second insert is a no-op", async () => {
    expect(await saveSnapshot(db, snap())).toEqual({ inserted: true });
    expect(await saveSnapshot(db, snap({ capturedAt: new Date("2026-10-08T07:00:00Z") }))).toEqual({
      inserted: false,
    });
  });

  it("treats NULL group_name and as_of as equal for dedupe, but distinct values as distinct", async () => {
    await saveSnapshot(db, snap({ kind: "sector_board", session: "intraday", asOf: "10:30" }));
    expect(
      await saveSnapshot(db, snap({ kind: "sector_board", session: "intraday", asOf: "10:30" })),
    ).toEqual({ inserted: false });
    expect(
      await saveSnapshot(db, snap({ kind: "sector_board", session: "intraday", asOf: "11:00" })),
    ).toEqual({ inserted: true });
    await saveSnapshot(db, snap({ kind: "sector_detail", groupName: "A" }));
    expect(await saveSnapshot(db, snap({ kind: "sector_detail", groupName: "B" }))).toEqual({
      inserted: true,
    });
  });

  it("keys dedupe on session: an unknown row never blocks the closed row of the same date", async () => {
    expect(await saveSnapshot(db, snap({ session: "unknown" }))).toEqual({ inserted: true });
    expect(await saveSnapshot(db, snap({ session: "closed" }))).toEqual({ inserted: true });
    expect(
      await saveSnapshot(
        db,
        snap({ session: "closed", capturedAt: new Date("2026-10-08T07:00:00Z") }),
      ),
    ).toEqual({ inserted: false });
    expect(await hasSnapshot(db, "digest", "2026-10-08", { session: "closed" })).toBe(true);
  });

  it("rejects an unknown session value", async () => {
    await expect(
      saveSnapshot(db, snap({ session: "bogus" as NewSnapshot["session"] })),
    ).rejects.toThrow();
  });

  it("latestSnapshot returns the newest by captured_at", async () => {
    await saveSnapshot(
      db,
      snap({
        kind: "sector_board",
        tradeDate: "2026-10-07",
        capturedAt: new Date("2026-10-07T06:00:00Z"),
      }),
    );
    await saveSnapshot(
      db,
      snap({ kind: "sector_board", capturedAt: new Date("2026-10-08T06:00:00Z") }),
    );
    const latest = await latestSnapshot(db, "sector_board");
    expect(latest?.tradeDate).toBe("2026-10-08");
    expect(latest?.parsed).toEqual({ ok: true });
    expect(await latestSnapshot(db, "digest")).toBeNull();
  });

  it("latestSnapshot filters by groupName", async () => {
    await saveSnapshot(db, snap({ kind: "sector_detail", groupName: "A" }));
    await saveSnapshot(
      db,
      snap({ kind: "sector_detail", groupName: "B", capturedAt: new Date("2026-10-08T09:00:00Z") }),
    );
    expect((await latestSnapshot(db, "sector_detail", { groupName: "A" }))?.groupName).toBe("A");
    expect((await latestSnapshot(db, "sector_detail"))?.groupName).toBe("B");
  });

  it("parsedOnly skips rows with parsed null", async () => {
    await saveSnapshot(
      db,
      snap({ tradeDate: "2026-10-07", capturedAt: new Date("2026-10-07T06:00:00Z") }),
    );
    await saveSnapshot(
      db,
      snap({ parsed: null, parseError: "boom", capturedAt: new Date("2026-10-08T06:00:00Z") }),
    );
    expect((await latestSnapshot(db, "digest"))?.parsed).toBeNull();
    expect((await latestSnapshot(db, "digest", { parsedOnly: true }))?.tradeDate).toBe(
      "2026-10-07",
    );
  });

  it("latestSnapshot filters by session", async () => {
    await saveSnapshot(db, snap({ session: "closed" }));
    await saveSnapshot(
      db,
      snap({ session: "intraday", asOf: "10:30", capturedAt: new Date("2026-10-09T02:30:00Z") }),
    );
    expect((await latestSnapshot(db, "digest"))?.session).toBe("intraday");
    expect((await latestSnapshot(db, "digest", { session: "closed" }))?.session).toBe("closed");
    expect(await latestSnapshot(db, "digest", { session: "unknown" })).toBeNull();
  });

  it("hasSnapshot checks trade date and optionally a closed session", async () => {
    await saveSnapshot(db, snap({ session: "intraday", asOf: "10:30" }));
    expect(await hasSnapshot(db, "digest", "2026-10-08")).toBe(true);
    expect(await hasSnapshot(db, "digest", "2026-10-08", { session: "closed" })).toBe(false);
    expect(await hasSnapshot(db, "digest", "2026-10-09")).toBe(false);
    await saveSnapshot(db, snap());
    expect(await hasSnapshot(db, "digest", "2026-10-08", { session: "closed" })).toBe(true);
  });

  describe("listClosedSnapshots", () => {
    it("returns one closed row per trade date, ascending, excluding intraday", async () => {
      await saveSnapshot(db, snap({ tradeDate: "2026-10-08" }));
      await saveSnapshot(
        db,
        snap({ tradeDate: "2026-10-01", capturedAt: new Date("2026-10-01T06:00:00Z") }),
      );
      await saveSnapshot(
        db,
        snap({ tradeDate: "2026-10-07", capturedAt: new Date("2026-10-07T06:00:00Z") }),
      );
      await saveSnapshot(
        db,
        snap({ session: "intraday", asOf: "10:30", capturedAt: new Date("2026-10-08T02:30:00Z") }),
      );
      const rows = await listClosedSnapshots(db, "digest", "2026-10-01", "2026-10-08");
      expect(rows.map((r) => r.tradeDate)).toEqual(["2026-10-01", "2026-10-07", "2026-10-08"]);
      expect(rows.every((r) => r.session === "closed")).toBe(true);
    });

    it("keeps the latest captured_at when a date has several closed rows", async () => {
      await saveSnapshot(db, snap({ asOf: "13:35", capturedAt: new Date("2026-10-08T05:35:00Z") }));
      await saveSnapshot(db, snap({ asOf: "14:10", capturedAt: new Date("2026-10-08T06:10:00Z") }));
      const rows = await listClosedSnapshots(db, "digest", "2026-10-08", "2026-10-08");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.asOf).toBe("14:10");
    });

    it("returns [] for a range with no data and ignores other kinds", async () => {
      await saveSnapshot(db, snap({ kind: "sector_board" }));
      expect(await listClosedSnapshots(db, "digest", "2026-10-01", "2026-10-08")).toEqual([]);
      expect(await listClosedSnapshots(db, "sector_board", "2026-11-01", "2026-11-08")).toEqual([]);
    });
  });
});
