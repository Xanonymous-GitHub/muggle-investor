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

function isPlan(body: unknown): body is PlanJson {
  return (
    typeof body === "object" &&
    body !== null &&
    "kind" in body &&
    typeof body.kind === "string" &&
    KINDS.includes(body.kind)
  );
}

/** An aborted request rejects with its `AbortError`: the caller cancelled it, nothing failed. */
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
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return failure("failed");
  }
  if (response.status === 400) return failure("invalid");
  if (response.status === 503) return failure("unavailable");
  if (!response.ok) return failure("failed");
  try {
    const body: unknown = await response.json();
    return isPlan(body) ? { ok: true, plan: body } : failure("failed");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return failure("failed");
  }
}
