import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
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

  it("keeps the database open during the test and closes it once the test has ended", async () => {
    const client = clientOf(await createTestDb());
    expect(client.closed).toBe(false);
    // Runs after the afterEach hooks, which is when the cleanup closes the database.
    onTestFinished(() => {
      expect(client.closed).toBe(true);
    });
  });
});
