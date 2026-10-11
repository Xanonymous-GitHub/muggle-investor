import { getEnv } from "@/config/env";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Liveness for the container HEALTHCHECK and load balancers: 503 when the environment fails
 * validation. Deliberately says nothing about which variables are wrong.
 */
export function GET(): Response {
  try {
    getEnv();
  } catch {
    return Response.json({ status: "unhealthy" }, { status: 503, headers: NO_STORE });
  }
  return Response.json({ status: "ok", app: "muggle-investor" }, { headers: NO_STORE });
}
