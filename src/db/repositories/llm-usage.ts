import { count, gte, sql } from "drizzle-orm";
import type { LlmUsage } from "@/insight/llm";
import type { Db } from "../client";
import { llmUsage } from "../schema";

export async function recordLlmUsage(
  db: Db,
  row: { purpose: string; model: string; usage: LlmUsage; createdAt?: Date },
): Promise<void> {
  await db.insert(llmUsage).values({
    purpose: row.purpose,
    model: row.model,
    inputTokens: row.usage.inputTokens,
    outputTokens: row.usage.outputTokens,
    ...(row.createdAt !== undefined && { createdAt: row.createdAt }),
  });
}

/** Totals for calls at or after `since`; unreported (null) token counts count as 0. */
export async function sumLlmUsage(
  db: Db,
  since: Date,
): Promise<{ calls: number; inputTokens: number; outputTokens: number }> {
  const [row] = await db
    .select({
      calls: count(),
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::float8`,
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::float8`,
    })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, since));
  return row ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
}
