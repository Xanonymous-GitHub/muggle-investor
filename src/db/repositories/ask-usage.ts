import { and, eq, sql } from "drizzle-orm";
import type { LlmUsage } from "@/insight/llm";
import type { Db } from "../client";
import { askUsage } from "../schema";

/**
 * Atomically takes one message from `subject`'s daily quota. A single upsert with a guarded
 * update, so concurrent requests can never push the count past `limit`; when the guard fails
 * no row is returned and the quota is spent.
 */
export async function consumeAskMessage(
  db: Db,
  input: { subject: string; day: string; limit: number },
): Promise<{ allowed: boolean; used: number }> {
  const [row] = await db
    .insert(askUsage)
    .values({ subject: input.subject, day: input.day, messages: 1 })
    .onConflictDoUpdate({
      target: [askUsage.subject, askUsage.day],
      set: { messages: sql`${askUsage.messages} + 1`, updatedAt: sql`now()` },
      setWhere: sql`${askUsage.messages} < ${input.limit}`,
    })
    .returning({ messages: askUsage.messages });
  return row ? { allowed: true, used: row.messages } : { allowed: false, used: input.limit };
}

/** Adds a call's token counts to the day's totals; unreported (null) counts add 0. */
export async function addAskTokens(
  db: Db,
  input: { subject: string; day: string; usage: LlmUsage },
): Promise<void> {
  const inputTokens = input.usage.inputTokens ?? 0;
  const outputTokens = input.usage.outputTokens ?? 0;
  await db
    .insert(askUsage)
    .values({ subject: input.subject, day: input.day, inputTokens, outputTokens })
    .onConflictDoUpdate({
      target: [askUsage.subject, askUsage.day],
      set: {
        inputTokens: sql`${askUsage.inputTokens} + ${inputTokens}`,
        outputTokens: sql`${askUsage.outputTokens} + ${outputTokens}`,
        updatedAt: sql`now()`,
      },
    });
}

export async function getAskUsage(
  db: Db,
  subject: string,
  day: string,
): Promise<{ messages: number; inputTokens: number; outputTokens: number }> {
  const [row] = await db
    .select({
      messages: askUsage.messages,
      inputTokens: askUsage.inputTokens,
      outputTokens: askUsage.outputTokens,
    })
    .from(askUsage)
    .where(and(eq(askUsage.subject, subject), eq(askUsage.day, day)));
  return row ?? { messages: 0, inputTokens: 0, outputTokens: 0 };
}
