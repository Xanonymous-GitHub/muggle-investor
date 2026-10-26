import { sql } from "drizzle-orm";
import type { Db } from "../client";
import { rateLimitWindow } from "../schema";

export type TakeResult = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * Atomically takes one token from `source`'s fixed-window budget, for limits that every app
 * instance shares (an upstream's quota). One upsert whose update applies only while the window
 * has ended (it then restarts with this token) or tokens are left, so concurrent callers can
 * never take more than `capacity` per window. When it does not apply, no row is returned and the
 * time left in the window is read back. All clock arithmetic runs in the database.
 */
export async function takeRateLimitToken(
  db: Db,
  input: { source: string; capacity: number; windowMs: number },
): Promise<TakeResult> {
  const windowEnded = sql`${rateLimitWindow.windowStart} + (${input.windowMs}::int * interval '1 millisecond') <= clock_timestamp()`;
  const [taken] = await db
    .insert(rateLimitWindow)
    .values({ source: input.source, windowStart: sql`clock_timestamp()`, used: 1 })
    .onConflictDoUpdate({
      target: rateLimitWindow.source,
      set: {
        windowStart: sql`case when ${windowEnded} then clock_timestamp() else ${rateLimitWindow.windowStart} end`,
        used: sql`case when ${windowEnded} then 1 else ${rateLimitWindow.used} + 1 end`,
      },
      setWhere: sql`${windowEnded} or ${rateLimitWindow.used} < ${input.capacity}`,
    })
    .returning({ used: rateLimitWindow.used });
  if (taken) return { ok: true };

  const [row] = await db
    .select({
      msLeft: sql<number>`greatest(1, ceil(extract(epoch from (${rateLimitWindow.windowStart} + (${input.windowMs}::int * interval '1 millisecond') - clock_timestamp())) * 1000))::int`,
    })
    .from(rateLimitWindow)
    .where(sql`${rateLimitWindow.source} = ${input.source}`);
  // The window can have ended between the two statements: a retry then succeeds at once.
  return { ok: false, retryAfterMs: row?.msLeft ?? 1 };
}
