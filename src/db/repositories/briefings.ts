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

/** A stored briefing no longer matches the content schema (as opposed to a database failure). */
export class BriefingDriftError extends Error {
  override name = "BriefingDriftError";
}

type ParsedRow = { briefing: Briefing } | { error: string };

function parseRow(row: BriefingRow): ParsedRow {
  const content = briefingContentSchema.safeParse(row.content);
  if (!content.success) {
    return {
      error: `Stored briefing ${row.kind} ${row.periodKey} (${row.lens}) no longer matches the content schema: ${content.error.message}`,
    };
  }
  return {
    briefing: {
      kind: row.kind,
      periodKey: row.periodKey,
      lens: row.lens,
      promptVersion: row.promptVersion,
      model: row.model,
      content: content.data,
      createdAt: row.createdAt,
    },
  };
}

/** Validates stored JSON on the way out so schema drift fails loudly instead of reaching readers. */
function toBriefing(row: BriefingRow): Briefing {
  const parsed = parseRow(row);
  if ("error" in parsed) throw new BriefingDriftError(parsed.error);
  return parsed.briefing;
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

async function selectBriefingRows(
  db: Db,
  kind: BriefingKind,
  fromKey: string,
  toKey: string,
  lens: Lens,
): Promise<BriefingRow[]> {
  return db
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
}

/** Briefings with `fromKey <= period_key <= toKey` (string comparison; both key formats sort lexicographically), ascending. */
export async function listBriefings(
  db: Db,
  kind: BriefingKind,
  fromKey: string,
  toKey: string,
  lens: Lens,
): Promise<Briefing[]> {
  return (await selectBriefingRows(db, kind, fromKey, toKey, lens)).map(toBriefing);
}

/**
 * Like `listBriefings`, but a stored row that no longer matches the content schema is left out
 * and reported in `skipped` (as "kind periodKey (lens)") instead of throwing, for readers that
 * should degrade rather than fail.
 */
export async function listBriefingsTolerant(
  db: Db,
  kind: BriefingKind,
  fromKey: string,
  toKey: string,
  lens: Lens,
): Promise<{ briefings: Briefing[]; skipped: string[] }> {
  const valid: Briefing[] = [];
  const skipped: string[] = [];
  for (const row of await selectBriefingRows(db, kind, fromKey, toKey, lens)) {
    const parsed = parseRow(row);
    if ("briefing" in parsed) valid.push(parsed.briefing);
    else skipped.push(`${row.kind} ${row.periodKey} (${row.lens})`);
  }
  return { briefings: valid, skipped };
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
