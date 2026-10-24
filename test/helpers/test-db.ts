import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { closeAfterTest } from "./test-db-cleanup";

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../drizzle");

/**
 * A data directory with the committed migrations already applied. Booting Postgres (PGlite) from
 * `initdb` and replaying every migration costs ~400 ms; loading this snapshot costs ~75 ms. Vitest
 * isolates modules per test file, so each file builds the snapshot once and every test clones it.
 */
let migratedTemplate: Promise<Blob> | undefined;

function loadMigratedTemplate(): Promise<Blob> {
  migratedTemplate ??= (async () => {
    const seed = new PGlite();
    await migrate(drizzle(seed, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    const snapshot = await seed.dumpDataDir("none");
    await seed.close();
    return snapshot;
  })();
  return migratedTemplate;
}

/**
 * Fresh in-memory Postgres (PGlite) with the committed migrations applied; clones share no state.
 * It is closed automatically when the test that created it ends.
 */
export async function createTestDb(): Promise<Db> {
  const client = closeAfterTest(new PGlite({ loadDataDir: await loadMigratedTemplate() }));
  return drizzle(client, { schema });
}
