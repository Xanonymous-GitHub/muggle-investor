import { afterEach } from "vitest";

interface Closable {
  close(): Promise<void>;
}

const open = new Set<Closable>();

/**
 * Remembers a test database so it is closed when the test ends. Every PGlite instance holds a
 * WASM Postgres of 150-250 MB until it is closed or garbage-collected, and the GC cannot keep up
 * once the instances are cheap to create: 40 abandoned ones grew a worker to ~9 GB.
 */
export function closeAfterTest<T extends Closable>(db: T): T {
  open.add(db);
  return db;
}

// Registers when a test file imports the test-db helper, so the callers need no teardown of their own.
afterEach(async () => {
  const finished = [...open];
  open.clear();
  await Promise.allSettled(finished.map((db) => db.close()));
});
