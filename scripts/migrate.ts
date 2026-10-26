/**
 * Applies the committed SQL migrations in ./drizzle (relative to the working directory) to
 * DATABASE_URL. Needs only drizzle-orm and postgres, not drizzle-kit, so it can run in production.
 *
 * Usage: bun run db:migrate:prod   (node scripts/migrate.ts; Node >= 22.18 runs .ts directly)
 * In the Docker image it is pre-bundled: docker run --rm -e DATABASE_URL=... <image> node migrate.mjs
 *
 * Safe to run from several pods at once: a session-level advisory lock makes the others wait, and
 * once they get it every migration is already applied. (drizzle's migrator takes no lock itself.)
 *
 * The URL is never printed: it contains the database password.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

/** Arbitrary constant shared by every migrator; no other code takes advisory locks on it. */
const MIGRATION_LOCK_ID = 7_265_431_908_112;

// One connection: the lock belongs to the session, so it must be the one that migrates, and
// closing the connection releases it even if this process dies mid-run.
const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await client`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
} catch (error) {
  // postgres.js errors carry the server message, not the connection string.
  console.error("migration failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end();
}
