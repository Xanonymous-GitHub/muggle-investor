import { describe, expect, it, vi } from "vitest";
import type { PlanRequest } from "@/planner/schema";
import { postPlan } from "@/ui/data/post-plan";

const request: PlanRequest = {
  answers: {
    age: "age-30-39",
    horizon: "horizon-10y-plus",
    income: "income-stable",
    reserve: "reserve-6m-plus",
    loss: "loss-hold",
  },
  lump: 100_000,
  monthly: 5_000,
  monthlyExpenses: 30_000,
  existingReserve: 0,
};

// Only the field postPlan reads.
const planBody: unknown = { kind: "plan" };

const respond = (response: Response) => vi.fn<typeof fetch>(async () => response);
const json = (body: unknown, status = 200): Response => Response.json(body, { status });

describe("postPlan", () => {
  it("POSTs the request as JSON to /api/plan", async () => {
    const fetchImpl = respond(json(planBody));
    await postPlan(request, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("/api/plan");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(request);
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("returns the plan on 200 for each result kind", async () => {
    for (const kind of ["plan", "reserve_only", "insufficient_history"]) {
      const body = { kind, extra: 1 };
      const result = await postPlan(request, { fetchImpl: respond(json(body)) });
      expect(result).toEqual({ ok: true, plan: body });
    }
  });

  it("maps a 200 with an unknown kind to failed", async () => {
    const result = await postPlan(request, {
      fetchImpl: respond(json({ kind: "other" })),
    });
    expect(result).toEqual({ ok: false, kind: "failed" });
  });

  it("maps a 200 that is not a JSON object to failed", async () => {
    for (const response of [
      new Response("<html>", { status: 200 }),
      json(null),
      json([]),
      json("plan"),
      json({ kind: 1 }),
    ]) {
      const result = await postPlan(request, { fetchImpl: respond(response) });
      expect(result).toEqual({ ok: false, kind: "failed" });
    }
  });

  it("maps 400 to invalid and 503 to unavailable", async () => {
    expect(
      await postPlan(request, { fetchImpl: respond(json({ error: "invalid" }, 400)) }),
    ).toEqual({ ok: false, kind: "invalid" });
    expect(
      await postPlan(request, {
        fetchImpl: respond(json({ error: "unavailable" }, 503)),
      }),
    ).toEqual({ ok: false, kind: "unavailable" });
  });

  it("maps 500 and a network error to failed", async () => {
    expect(await postPlan(request, { fetchImpl: respond(json({ error: "x" }, 500)) })).toEqual({
      ok: false,
      kind: "failed",
    });
    const throwing = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network down");
    });
    expect(await postPlan(request, { fetchImpl: throwing })).toEqual({
      ok: false,
      kind: "failed",
    });
  });

  it("rejects with AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    // A fetch that honours its signal, as the real one does.
    const fetchImpl: typeof fetch = async (_url, init) => {
      init?.signal?.throwIfAborted();
      return json(planBody);
    };
    await expect(postPlan(request, { signal: controller.signal, fetchImpl })).rejects.toMatchObject(
      { name: "AbortError" },
    );
  });
});
