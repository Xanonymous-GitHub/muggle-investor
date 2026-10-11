import { getEnv } from "@/config/env";
import { runIngestion } from "@/ingestion/run-ingestion";
import { verifyBearer } from "@/lib/auth/bearer";
import { logger } from "@/lib/logger";
import { getDarkfanxingClient, getDb, getFinMindClient, getTwseClient } from "@/server/services";
import { redactKey } from "@/sources/darkfanxing";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Error text for logs with the upstream key scrubbed (EnvError messages name keys, not values). */
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  try {
    return redactKey(message, getEnv().DARKFANXING_KEY, "***");
  } catch {
    return message;
  }
}

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
      now: new Date(),
      logger,
    });
    return Response.json(report, { headers: NO_STORE });
  } catch (error) {
    logger.error({ error: safeMessage(error) }, "ingestion run failed");
    return Response.json({ error: "ingestion failed" }, { status: 500, headers: NO_STORE });
  }
}

export const GET = ingest;
export const POST = ingest;
