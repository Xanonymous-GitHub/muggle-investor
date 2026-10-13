import { getEnv } from "@/config/env";
import { runIngestion } from "@/ingestion/run-ingestion";
import { verifyBearer } from "@/lib/auth/bearer";
import { logger } from "@/lib/logger";
import { safeErrorMessage } from "@/server/safe-error";
import {
  getDarkfanxingClient,
  getDb,
  getFinMindClient,
  getLlm,
  getTwseClient,
} from "@/server/services";

export const dynamic = "force-dynamic";
/**
 * Seconds a run may take where the platform enforces it (Vercel); ignored on Node. Briefing
 * actions stop starting after `BRIEFING_RUN_BUDGET_MS`, below this limit.
 */
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" };

/**
 * Called by the scheduler (k8s CronJob, Vercel Cron, GitHub Actions) with
 * `Authorization: Bearer $CRON_SECRET`; responds with the IngestionReport.
 */
async function ingest(request: Request): Promise<Response> {
  try {
    const env = getEnv();
    if (!verifyBearer(request.headers.get("authorization"), env.CRON_SECRET)) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const report = await runIngestion({
      db: getDb(),
      darkfanxing: getDarkfanxingClient(),
      darkfanxingKey: env.DARKFANXING_KEY,
      finmind: getFinMindClient(),
      twse: getTwseClient(),
      llm: getLlm(),
      now: new Date(),
      logger,
    });
    return Response.json(report, { headers: NO_STORE });
  } catch (error) {
    logger.error({ error: safeErrorMessage(error) }, "ingestion run failed");
    return Response.json({ error: "ingestion failed" }, { status: 500, headers: NO_STORE });
  }
}

export const GET = ingest;
export const POST = ingest;
