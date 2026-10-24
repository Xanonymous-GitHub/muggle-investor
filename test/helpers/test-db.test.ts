import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "./test-db";

const clientOf = (db: Db): PGlite => (db as unknown as { $client: PGlite }).$client;

const migrationCount = (
  JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../../drizzle/meta/_journal.json"), "utf8"),
  ) as { entries: unknown[] }
).entries.length;

describe("createTestDb", () => {
  it("applies every committed migration", async () => {
    const db = await createTestDb();
    const { rows } = await clientOf(db).query<{ n: number }>(
      "select count(*)::int as n from drizzle.__drizzle_migrations",
    );
    expect(rows).toEqual([{ n: migrationCount }]);
  });

  it("hands out databases that share no state", async () => {
    const [first, second] = [await createTestDb(), await createTestDb()];
    await first.execute(sql`create table only_in_first (id int)`);
    const { rows } = await clientOf(second).query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_name = 'only_in_first'",
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  // These two run in order: the second sees what the first left behind.
  let lastTestsClient: PGlite | undefined;

  it("keeps the database open for the whole test", async () => {
    lastTestsClient = clientOf(await createTestDb());
    expect(lastTestsClient.closed).toBe(false);
  });

  it("closes a test's database once that test has ended", () => {
    expect(lastTestsClient?.closed).toBe(true);
  });
});
