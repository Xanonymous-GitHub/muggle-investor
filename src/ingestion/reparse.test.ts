import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { type NewSnapshot, type Snapshot, saveSnapshot } from "@/db/repositories/snapshots";
import { marketSnapshots } from "@/db/schema";
import { createTestDb } from "../../test/helpers/test-db";
import { reparseSnapshots } from "./reparse";
import { PARSER_VERSION } from "./snapshot-row";

const fixture = (name: string) => readFileSync(`test/fixtures/darkfanxing/${name}`, "utf8");
const DIGEST = fixture("digest-2026-10-08.html");
const BOARD = fixture("now-2026-10-08.html");
const DETAIL = fixture("group-quartz-2026-10-08.html");

const silent = pino({ level: "silent" });

const unparsed = (overrides: Partial<NewSnapshot> = {}): NewSnapshot => ({
  kind: "digest",
  groupName: null,
  tradeDate: "2026-10-01",
  asOf: null,
  session: "unknown",
  capturedAt: new Date("2026-10-08T07:00:00Z"),
  rawHtml: DIGEST,
  parsed: null,
  parseError: "x",
  parserVersion: 1,
  ...overrides,
});

describe("reparseSnapshots", () => {
  let db: Db;
  const reparse = (opts?: { limit?: number; currentParserVersion?: number }) =>
    reparseSnapshots({ db, logger: silent }, opts);
  const rows = () => db.select().from(marketSnapshots);
  const only = async (): Promise<Snapshot> => {
    const [row] = await rows();
    if (!row) throw new Error("expected a stored row");
    return row;
  };

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("re-parses an unparsed digest and dates the row from the parsed result", async () => {
    await saveSnapshot(db, unparsed());

    const result = await reparse();

    expect(result).toEqual({ scanned: 1, fixed: 1, stillFailing: 0, conflicts: 0 });
    const row = await only();
    expect((row.parsed as { market: { force: number } }).market.force).toBe(-0.63);
    expect(row.parseError).toBeNull();
    expect(row.tradeDate).toBe("2026-10-08");
    expect(row.session).toBe("closed");
    expect(row.parserVersion).toBe(PARSER_VERSION);
  });

  it("re-parses an unparsed sector board", async () => {
    await saveSnapshot(db, unparsed({ kind: "sector_board", rawHtml: BOARD }));

    expect(await reparse()).toMatchObject({ fixed: 1 });

    const row = await only();
    expect(row.parsed).not.toBeNull();
    expect(row.parseError).toBeNull();
    expect(row.tradeDate).toBe("2026-10-08");
    expect(row.asOf).toBe("13:34");
    expect(row.session).toBe("closed");
  });

  it("re-parses an unparsed sector detail and keeps its group name", async () => {
    await saveSnapshot(
      db,
      unparsed({ kind: "sector_detail", groupName: "石英元件", rawHtml: DETAIL }),
    );

    expect(await reparse()).toMatchObject({ fixed: 1 });

    const row = await only();
    expect(row.parsed).toMatchObject({ group: "石英元件", tradeDate: "2026-10-08" });
    expect(row.parseError).toBeNull();
    expect(row.tradeDate).toBe("2026-10-08");
    expect(row.groupName).toBe("石英元件");
  });

  it("keeps every column but parse_error when the raw still does not parse", async () => {
    await saveSnapshot(db, unparsed({ rawHtml: "<html>nope</html>" }));
    const before = await only();

    const result = await reparse();

    expect(result).toEqual({ scanned: 1, fixed: 0, stillFailing: 1, conflicts: 0 });
    const after = await only();
    expect(after.parsed).toBeNull();
    expect(after.parseError).toBeTruthy();
    expect(after.parseError).not.toBe("x");
    expect(after.parseError).not.toContain("<html>");
    expect(after).toEqual({ ...before, parseError: after.parseError });
  });

  it("does not wipe a good parse when a later parser version fails on the raw", async () => {
    await saveSnapshot(
      db,
      unparsed({ rawHtml: "<html>nope</html>", parsed: { old: true }, parseError: null }),
    );

    const result = await reparse({ currentParserVersion: 2 });

    expect(result.stillFailing).toBe(1);
    const row = await only();
    expect(row.parsed).toEqual({ old: true });
    expect(row.parserVersion).toBe(1);
    expect(row.parseError).toBeTruthy();
  });

  it("scans parsed rows only when their parser version is outdated", async () => {
    await saveSnapshot(
      db,
      unparsed({ parsed: { old: true }, parseError: null, parserVersion: PARSER_VERSION }),
    );

    expect(await reparse()).toEqual({ scanned: 0, fixed: 0, stillFailing: 0, conflicts: 0 });
    expect((await only()).parsed).toEqual({ old: true });

    expect(await reparse({ currentParserVersion: PARSER_VERSION + 1 })).toMatchObject({
      scanned: 1,
      fixed: 1,
    });
    const row = await only();
    expect(row.parserVersion).toBe(PARSER_VERSION + 1);
    expect((row.parsed as { market: { force: number } }).market.force).toBe(-0.63);
  });

  it("leaves a row unchanged when its parsed dates collide with another row", async () => {
    await saveSnapshot(db, unparsed({ tradeDate: "2026-10-08", session: "unknown" }));
    await saveSnapshot(
      db,
      unparsed({
        tradeDate: "2026-10-08",
        session: "closed",
        parsed: { ok: true },
        parseError: null,
        parserVersion: PARSER_VERSION,
      }),
    );
    const [before] = await db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.session, "unknown"));

    const result = await reparse();

    expect(result).toEqual({ scanned: 1, fixed: 0, stillFailing: 0, conflicts: 1 });
    const [after] = await db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.session, "unknown"));
    expect(after).toEqual(before);
    expect(await rows()).toHaveLength(2);
  });

  it("respects the limit, oldest trade date first", async () => {
    await saveSnapshot(db, unparsed({ tradeDate: "2026-10-03", rawHtml: "<html>nope</html>" }));
    await saveSnapshot(db, unparsed({ tradeDate: "2026-10-02", rawHtml: "<html>nope</html>" }));
    await saveSnapshot(db, unparsed({ tradeDate: "2026-10-01", rawHtml: "<html>nope</html>" }));

    expect(await reparse({ limit: 1 })).toMatchObject({ scanned: 1, stillFailing: 1 });

    const touched = (await rows()).filter((row) => row.parseError !== "x");
    expect(touched.map((row) => row.tradeDate)).toEqual(["2026-10-01"]);
  });

  it("never modifies raw_html", async () => {
    await saveSnapshot(db, unparsed());
    await saveSnapshot(db, unparsed({ tradeDate: "2026-10-02", rawHtml: "<html>nope</html>" }));
    const before = (await rows()).map((row) => [row.id, row.rawHtml]).sort();

    await reparse();

    expect((await rows()).map((row) => [row.id, row.rawHtml]).sort()).toEqual(before);
  });
});
