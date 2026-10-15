/**
 * DEV ONLY. Stores one clearly labelled sample daily briefing per lens (text starts with 【範例】,
 * model "sample") for the latest stored closed digest date, and the ten sample plan explanations
 * (five levels × two lenses) for the current ISO week, so the UI can be looked at locally
 * without an LLM endpoint.
 *
 * Usage: bun run briefing:sample
 *
 * Refuses to run when NODE_ENV is "production". Samples are stored at prompt version 0, so they
 * never replace a real briefing or plan explanation, and the next real generation (version >= 1)
 * replaces them. Prints only the date and counts; failures print only `describeFailure`'s fixed category.
 */
import { getEnv } from "@/config/env";
import { saveBriefing } from "@/db/repositories/briefings";
import { latestClosedTradeDate } from "@/db/repositories/snapshots";
import { LENSES } from "@/insight/lens";
import { buildSampleBriefing, seedSamplePlanExplanations } from "@/insight/sample-briefing";
import { describeFailure } from "@/server/describe-failure";
import { getDb } from "@/server/services";

if (process.env.NODE_ENV === "production") {
  console.error("briefing:sample is dev-only and refuses to run with NODE_ENV=production");
  process.exit(1);
}

const SAMPLE_PROMPT_VERSION = 0;

const exitCode = await run().catch((error: unknown) => {
  console.error(describeFailure(error));
  return 1;
});
process.exit(exitCode);

async function run(): Promise<number> {
  getEnv();
  const db = getDb();
  const plans = await seedSamplePlanExplanations(db, new Date());
  console.log(
    `${plans.saved} of ${plans.total} sample plan explanations saved` +
      (plans.saved < plans.total ? ` (${plans.total - plans.saved} already stored, kept)` : ""),
  );
  const date = await latestClosedTradeDate(db, "digest");
  if (!date) {
    console.error("no parsed closed digest is stored; run the ingestion job first");
    return 1;
  }
  let saved = 0;
  for (const lens of LENSES) {
    const result = await saveBriefing(db, {
      kind: "daily",
      periodKey: date,
      lens,
      promptVersion: SAMPLE_PROMPT_VERSION,
      model: "sample",
      content: buildSampleBriefing(lens, date),
    });
    if (result.saved) saved++;
  }
  console.log(
    `trade date ${date}: ${saved} of ${LENSES.length} sample briefings saved` +
      (saved < LENSES.length ? ` (${LENSES.length - saved} already stored, kept)` : ""),
  );
  return 0;
}
