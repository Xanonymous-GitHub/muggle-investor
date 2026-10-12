/**
 * Generates the daily briefings (both lenses) for one closed trade date with the real database and
 * LLM endpoint from .env, to check a prompt or an endpoint by hand.
 *
 * Usage: bun run briefing:dev -- [YYYY-MM-DD]
 *
 * Without a date it uses the latest stored closed digest. Per lens it prints the status
 * (saved / skipped / rejected plus the validator's reasons), the headline of the stored briefing
 * and the token usage of this run. A briefing already stored at the current prompt version is
 * `skipped` (no LLM call). Failures print only the error class and a fixed category
 * (`describeFailure`), never an error message, so no prompt, model reply, key or database URL can
 * reach the output. Exits 1 on an invalid date or environment, no stored digest, a database
 * failure, or when every lens failed.
 */
import { getEnv } from "@/config/env";
import { getBriefing } from "@/db/repositories/briefings";
import { getClosedSnapshot, latestClosedTradeDate } from "@/db/repositories/snapshots";
import { generateDailyBriefing } from "@/insight/generate-daily";
import { LENSES, type Lens } from "@/insight/lens";
import type { Llm, LlmUsage } from "@/insight/llm";
import { isCalendarDate } from "@/lib/dates";
import { logger } from "@/lib/logger";
import { describeFailure } from "@/server/describe-failure";
import { getDb, getLlm } from "@/server/services";
import { digestSnapshotSchema, sectorBoardSchema } from "@/sources/darkfanxing/schemas";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const dateArg = process.argv[2];
if (dateArg !== undefined && !isCalendarDate(dateArg)) {
  fail(`invalid date "${dateArg}", expected YYYY-MM-DD`);
}

const exitCode = await run(dateArg).catch((error: unknown) => {
  console.error(describeFailure(error));
  return 1;
});
process.exit(exitCode);

/** Returns the exit code; anything thrown here is reported by `describeFailure` only. */
async function run(dateArg: string | undefined): Promise<number> {
  getEnv();
  const db = getDb();
  const date =
    dateArg ??
    (await latestClosedTradeDate(db, "digest")) ??
    fail("no parsed closed digest is stored; run the ingestion job first");

  const digestRow =
    (await getClosedSnapshot(db, "digest", date)) ?? fail(`no parsed closed digest for ${date}`);
  const digest = digestSnapshotSchema.safeParse(digestRow.parsed);
  if (!digest.success) fail(`the stored digest for ${date} no longer validates; re-parse it first`);

  const boardRow = await getClosedSnapshot(db, "sector_board", date);
  const parsedBoard = sectorBoardSchema.safeParse(boardRow?.parsed);
  const board =
    parsedBoard.success && parsedBoard.data.tradeDate === date ? parsedBoard.data : null;

  console.log(`trade date ${date}${board ? "" : " (no matching sector board; thinner facts)"}`);

  const llm = getLlm();
  console.log(`model ${llm.modelId}`);

  let failed = 0;
  for (const lens of LENSES) {
    // Count what this lens's calls cost, including the repair call.
    const used: LlmUsage = { inputTokens: null, outputTokens: null };
    let calls = 0;
    const metered: Llm = {
      modelId: llm.modelId,
      async generateObject(req) {
        calls++;
        const result = await llm.generateObject(req);
        used.inputTokens = (used.inputTokens ?? 0) + (result.usage.inputTokens ?? 0);
        used.outputTokens = (used.outputTokens ?? 0) + (result.usage.outputTokens ?? 0);
        return result;
      },
    };
    try {
      const result = await generateDailyBriefing(
        { db, llm: metered, logger },
        { digest: digest.data, board, lens },
      );
      if (result.status === "rejected") failed++;
      const reasons = result.reasons?.length ? ` (${result.reasons.join("; ")})` : "";
      console.log(`[${lens}] ${result.status}${reasons}`);
      printHeadline(lens, await getBriefing(db, "daily", date, lens));
    } catch (error) {
      failed++;
      console.log(`[${lens}] failed: ${describeFailure(error)}`);
    }
    console.log(`[${lens}] llm calls ${calls}; tokens ${tokens(used, calls)}`);
  }
  return failed === LENSES.length ? 1 : 0;
}

function printHeadline(lens: Lens, stored: Awaited<ReturnType<typeof getBriefing>>) {
  console.log(`[${lens}] headline: ${stored ? stored.content.headline : "(none stored)"}`);
}

function tokens(usage: LlmUsage, calls: number): string {
  if (calls === 0) return "n/a (no LLM call)";
  return `in ${usage.inputTokens ?? "?"} / out ${usage.outputTokens ?? "?"}`;
}
