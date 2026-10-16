// One POST of the planner form to /api/plan, with every failure mapped to a kind the UI can explain.
import type { PlanRequest } from "@/planner/schema";
import { type PlanJson, planUrl } from "@/ui/data/api";

export type PostPlanResult =
  | { ok: true; plan: PlanJson }
  | { ok: false; kind: "invalid" | "unavailable" | "failed" };

const failure = (kind: "invalid" | "unavailable" | "failed"): PostPlanResult => ({
  ok: false,
  kind,
});

const KINDS: readonly string[] = ["plan", "reserve_only", "insufficient_history"];

/**
 * Checks only `kind`: the rest of the body is trusted to be what the server's Zod response schema
 * (src/planner/schema.ts) produced, so a body with a known `kind` but a broken shape passes.
 */
function isPlan(body: unknown): body is PlanJson {
  return (
    typeof body === "object" &&
    body !== null &&
    "kind" in body &&
    typeof body.kind === "string" &&
    KINDS.includes(body.kind)
  );
}

/** An `AbortError`, or any error after the caller's signal aborted (a custom reason is not one). */
const cancelled = (error: unknown, signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");

/**
 * A request the caller aborted rejects (with fetch's `AbortError`, or the abort reason if the
 * caller gave one): the caller cancelled it, nothing failed.
 */
export async function postPlan(
  request: PlanRequest,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<PostPlanResult> {
  const { signal, fetchImpl = fetch } = opts;
  let response: Response;
  try {
    response = await fetchImpl(planUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (cancelled(error, signal)) throw error;
    return failure("failed");
  }
  if (response.status === 400) return failure("invalid");
  if (response.status === 503) return failure("unavailable");
  if (!response.ok) return failure("failed");
  try {
    const body: unknown = await response.json();
    return isPlan(body) ? { ok: true, plan: body } : failure("failed");
  } catch (error) {
    if (cancelled(error, signal)) throw error;
    return failure("failed");
  }
}
