import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { type BriefingContent, briefingContentSchema } from "@/insight/briefing-content";
import type { Lens } from "@/insight/lens";
import type { Db } from "../client";
import { briefings } from "../schema";

export type BriefingKind = "daily" | "weekly";

export type Briefing = {
  kind: BriefingKind;
  periodKey: string;
  lens: Lens;
  promptVersion: number;
  model: string;
  content: BriefingContent;
  createdAt: Date;
};

type BriefingRow = typeof briefings.$inferSelect;

/** Validates stored JSON on the way out so schema drift fails loudly instead of reaching readers. */
function toBriefing(row: BriefingRow): Briefing {
  const content = briefingContentSchema.safeParse(row.content);
  if (!content.success) {
    throw new Error(
      `Stored briefing ${row.kind} ${row.periodKey} (${row.lens}) no longer matches the content schema: ${content.error.message}`,
    );
  }
  return {
    kind: row.kind,
    periodKey: row.periodKey,
    lens: row.lens,
    promptVersion: row.promptVersion,
    model: row.model,
    content: content.data,
    createdAt: row.createdAt,
  };
}

/**
 * Stores a briefing. If one already exists for `(kind, period_key, lens)` it is replaced only when
 * `promptVersion` is greater, in one atomic statement; otherwise nothing changes and
 * `{ saved: false }` is returned. `period_key` must match `kind` (database check constraint), and
 * `content` must satisfy `briefingContentSchema` (throws before writing).
 */
export async function saveBriefing(
  db: Db,
  b: Omit<Briefing, "createdAt"> & { createdAt?: Date },
): Promise<{ saved: boolean }> {
  const content = briefingContentSchema.parse(b.content);
  const rows = await db
    .insert(briefings)
    .values({ ...b, content })
    .onConflictDoUpdate({
      target: [briefings.kind, briefings.periodKey, briefings.lens],
      set: {
        promptVersion: sql`excluded.prompt_version`,
        model: sql`excluded.model`,
        content: sql`excluded.content`,
        createdAt: sql`excluded.created_at`,
      },
      setWhere: sql`excluded.prompt_version > ${briefings.promptVersion}`,
    })
    .returning({ id: briefings.id });
  return { saved: rows.length > 0 };
}

export async function getBriefing(
  db: Db,
  kind: BriefingKind,
  periodKey: string,
  lens: Lens,
): Promise<Briefing | null> {
  const [row] = await db
    .select()
    .from(briefings)
    .where(
      and(eq(briefings.kind, kind), eq(briefings.periodKey, periodKey), eq(briefings.lens, lens)),
    )
    .limit(1);
  return row ? toBriefing(row) : null;
}

/** Briefing with the greatest `period_key` for the kind and lens. */
export async function latestBriefing(
  db: Db,
  kind: BriefingKind,
  lens: Lens,
): Promise<Briefing | null> {
  const [row] = await db
    .select()
    .from(briefings)
    .where(and(eq(briefings.kind, kind), eq(briefings.lens, lens)))
    .orderBy(desc(briefings.periodKey))
    .limit(1);
  return row ? toBriefing(row) : null;
}

/** Briefings with `fromKey <= period_key <= toKey` (string comparison; both key formats sort lexicographically), ascending. */
export async function listBriefings(
  db: Db,
  kind: BriefingKind,
  fromKey: string,
  toKey: string,
  lens: Lens,
): Promise<Briefing[]> {
  const rows = await db
    .select()
    .from(briefings)
    .where(
      and(
        eq(briefings.kind, kind),
        eq(briefings.lens, lens),
        gte(briefings.periodKey, fromKey),
        lte(briefings.periodKey, toKey),
      ),
    )
    .orderBy(asc(briefings.periodKey));
  return rows.map(toBriefing);
}

export async function hasBriefing(
  db: Db,
  kind: BriefingKind,
  periodKey: string,
  lens: Lens,
  minPromptVersion: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: briefings.id })
    .from(briefings)
    .where(
      and(
        eq(briefings.kind, kind),
        eq(briefings.periodKey, periodKey),
        eq(briefings.lens, lens),
        gte(briefings.promptVersion, minPromptVersion),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
