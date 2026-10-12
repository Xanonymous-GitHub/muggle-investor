import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "../../../test/helpers/test-db";
import {
  getClosedSnapshot,
  hasSnapshot,
  isUniqueViolation,
  latestSnapshot,
  listClosedSnapshots,
  listReparseCandidates,
  markReparseAttempted,
  type NewSnapshot,
  saveSnapshot,
  touchSnapshot,
  updateSnapshotParse,
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

  it("touchSnapshot moves captured_at of the deduped row and nothing else", async () => {
    await saveSnapshot(db, snap({ kind: "sector_detail", groupName: "A", asOf: "10:30" }));
    await saveSnapshot(db, snap({ kind: "sector_detail", groupName: "B", asOf: "10:30" }));
    const later = new Date("2026-10-08T07:00:00Z");

    await touchSnapshot(
      db,
      snap({ kind: "sector_detail", groupName: "A", asOf: "10:30", capturedAt: later, parsed: 1 }),
    );

    const a = await latestSnapshot(db, "sector_detail", { groupName: "A" });
    expect(a?.capturedAt).toEqual(later);
    expect(a?.parsed).toEqual({ ok: true });
    const b = await latestSnapshot(db, "sector_detail", { groupName: "B" });
    expect(b?.capturedAt).toEqual(new Date("2026-10-08T06:00:00Z"));
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

    const unparsedLater = async () => {
      await saveSnapshot(db, snap({ asOf: "13:35", capturedAt: new Date("2026-10-08T05:35:00Z") }));
      await saveSnapshot(
        db,
        snap({
          asOf: "14:10",
          capturedAt: new Date("2026-10-08T06:10:00Z"),
          parsed: null,
          parseError: "broken",
        }),
      );
    };

    it("by default a later unparsed capture hides an earlier parsed one", async () => {
      await unparsedLater();
      const rows = await listClosedSnapshots(db, "digest", "2026-10-08", "2026-10-08");
      expect(rows.map((r) => r.asOf)).toEqual(["14:10"]);
    });

    it("parsedOnly picks the latest parsed row per date and drops dates with none", async () => {
      await unparsedLater();
      await saveSnapshot(db, snap({ tradeDate: "2026-10-07", parsed: null, parseError: "broken" }));
      const rows = await listClosedSnapshots(db, "digest", "2026-10-01", "2026-10-08", {
        parsedOnly: true,
      });
      expect(rows.map((r) => [r.tradeDate, r.asOf])).toEqual([["2026-10-08", "13:35"]]);
    });
  });

  describe("getClosedSnapshot", () => {
    it("returns the latest parsed closed row of that kind and date", async () => {
      await saveSnapshot(db, snap({ asOf: "13:35", capturedAt: new Date("2026-10-08T05:35:00Z") }));
      await saveSnapshot(db, snap({ asOf: "14:10", capturedAt: new Date("2026-10-08T06:10:00Z") }));
      await saveSnapshot(
        db,
        snap({
          asOf: "15:00",
          capturedAt: new Date("2026-10-08T07:00:00Z"),
          parsed: null,
          parseError: "broken",
        }),
      );
      await saveSnapshot(
        db,
        snap({ session: "intraday", asOf: "16:00", capturedAt: new Date("2026-10-08T08:00:00Z") }),
      );
      await saveSnapshot(db, snap({ kind: "sector_board", asOf: "99:99" }));

      const row = await getClosedSnapshot(db, "digest", "2026-10-08");

      expect(row?.asOf).toBe("14:10");
    });

    it("returns null when the date has no parsed closed row of that kind", async () => {
      await saveSnapshot(db, snap({ parsed: null, parseError: "broken" }));
      await saveSnapshot(db, snap({ session: "intraday", asOf: "10:30" }));
      expect(await getClosedSnapshot(db, "digest", "2026-10-08")).toBeNull();
      expect(await getClosedSnapshot(db, "sector_board", "2026-10-08")).toBeNull();
      expect(await getClosedSnapshot(db, "digest", "2026-10-09")).toBeNull();
    });
  });

  describe("re-parse maintenance", () => {
    const patch = (overrides: Partial<Parameters<typeof updateSnapshotParse>[2]> = {}) => ({
      tradeDate: "2026-10-08",
      asOf: null,
      session: "closed" as const,
      parsed: { fresh: true },
      parseError: null,
      parserVersion: 2,
      ...overrides,
    });

    it("lists rows that are unparsed or outdated, oldest trade date first, up to the limit", async () => {
      await saveSnapshot(db, snap({ tradeDate: "2026-10-05", parsed: null, parseError: "x" }));
      await saveSnapshot(db, snap({ tradeDate: "2026-10-03", parserVersion: 1 }));
      await saveSnapshot(db, snap({ tradeDate: "2026-10-04", parserVersion: 2 }));
      await saveSnapshot(db, snap({ tradeDate: "2026-10-06", parserVersion: 1 }));

      const all = await listReparseCandidates(db, { currentParserVersion: 2, limit: 10 });
      expect(all.map((r) => r.tradeDate)).toEqual(["2026-10-03", "2026-10-05", "2026-10-06"]);
      const limited = await listReparseCandidates(db, { currentParserVersion: 2, limit: 2 });
      expect(limited.map((r) => r.tradeDate)).toEqual(["2026-10-03", "2026-10-05"]);
    });

    it("updates parse columns and dates in place without touching raw_html or captured_at", async () => {
      await saveSnapshot(db, snap({ session: "unknown", parsed: null, parseError: "x" }));
      const before = await latestSnapshot(db, "digest");
      if (!before) throw new Error("expected a row");

      expect(await updateSnapshotParse(db, before.id, patch())).toEqual({ updated: true });

      const after = await latestSnapshot(db, "digest");
      expect(after).toEqual({
        ...before,
        session: "closed",
        parsed: { fresh: true },
        parseError: null,
        parserVersion: 2,
      });
    });

    it("reports a collision instead of throwing and leaves the row unchanged", async () => {
      await saveSnapshot(db, snap({ session: "closed" }));
      await saveSnapshot(db, snap({ session: "unknown", parsed: null, parseError: "x" }));
      const before = await latestSnapshot(db, "digest", { session: "unknown" });
      if (!before) throw new Error("expected a row");

      expect(await updateSnapshotParse(db, before.id, patch())).toEqual({ updated: false });

      expect(await latestSnapshot(db, "digest", { session: "unknown" })).toEqual(before);
    });

    it("excludes rows already attempted at the current version, until the version rises", async () => {
      await saveSnapshot(db, snap({ tradeDate: "2026-10-03", parsed: null, parseError: "x" }));
      await saveSnapshot(db, snap({ tradeDate: "2026-10-04", parsed: null, parseError: "x" }));
      const [first] = await listReparseCandidates(db, { currentParserVersion: 1, limit: 10 });
      if (!first) throw new Error("expected a row");

      await markReparseAttempted(db, first.id, 1, "still broken");

      const same = await listReparseCandidates(db, { currentParserVersion: 1, limit: 10 });
      expect(same.map((r) => r.tradeDate)).toEqual(["2026-10-04"]);
      const bumped = await listReparseCandidates(db, { currentParserVersion: 2, limit: 10 });
      expect(bumped.map((r) => r.tradeDate)).toEqual(["2026-10-03", "2026-10-04"]);
    });

    it("markReparseAttempted touches only the marker and, when given, parse_error", async () => {
      await saveSnapshot(db, snap({ parsed: { old: true }, parserVersion: 1 }));
      const before = await latestSnapshot(db, "digest");
      if (!before) throw new Error("expected a row");

      await markReparseAttempted(db, before.id, 2);
      expect(await latestSnapshot(db, "digest")).toEqual({
        ...before,
        reparseAttemptedVersion: 2,
      });

      await markReparseAttempted(db, before.id, 3, "boom");
      expect(await latestSnapshot(db, "digest")).toEqual({
        ...before,
        reparseAttemptedVersion: 3,
        parseError: "boom",
      });
    });

    it("detects a unique violation on the error or nested in its cause chain", () => {
      const pg = Object.assign(new Error("x"), { code: "23505" });
      expect(isUniqueViolation(pg)).toBe(true);
      expect(isUniqueViolation(Object.assign(new Error("w"), { cause: pg }))).toBe(true);
      expect(
        isUniqueViolation(
          Object.assign(new Error("w"), {
            cause: Object.assign(new Error("x"), { code: "23514" }),
          }),
        ),
      ).toBe(false);
      expect(isUniqueViolation("23505")).toBe(false);
      expect(isUniqueViolation(new Error("plain"))).toBe(false);
    });

    it("rethrows errors that are not unique violations", async () => {
      await saveSnapshot(db, snap({ parsed: null }));
      const row = await latestSnapshot(db, "digest");
      if (!row) throw new Error("expected a row");

      await expect(
        updateSnapshotParse(db, row.id, patch({ session: "bogus" as NewSnapshot["session"] })),
      ).rejects.toThrow();
    });
  });
});
