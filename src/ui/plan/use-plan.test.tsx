import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRequest } from "@/planner/schema";
import { usePlan } from "@/ui/plan/use-plan";
import { LEVEL1_PLAN, LEVEL3_PLAN } from "@/ui/test/plan-fixture";

const REQUEST: PlanRequest = {
  answers: {
    age: "age-40-49",
    horizon: "horizon-5-10y",
    income: "income-stable",
    reserve: "reserve-3-6m",
    loss: "loss-hold",
  },
  lump: 600_000,
  monthly: 15_000,
  monthlyExpenses: 30_000,
  existingReserve: 90_000,
};
const OTHER: PlanRequest = { ...REQUEST, lump: 100_000 };

type Pending = {
  body: PlanRequest;
  signal: AbortSignal | null | undefined;
  respond(response: Response): void;
};
let calls: Pending[];

/** A fetch whose responses the test settles by hand; an abort rejects like the real one. */
function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        calls.push({
          body: JSON.parse(String(init?.body)) as PlanRequest,
          signal,
          respond: resolve,
        });
      });
    }),
  );
}

const setOnline = (value: boolean) =>
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });

beforeEach(() => {
  stubFetch();
  setOnline(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setOnline(true);
});

describe("usePlan", () => {
  it("is idle without a request and calls nothing", () => {
    const { result } = renderHook(() => usePlan(null));
    expect(result.current.status).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("loads, then holds the plan", async () => {
    const { result } = renderHook(() => usePlan(REQUEST));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual(REQUEST);
    await act(async () => calls[0]?.respond(Response.json(LEVEL3_PLAN)));
    expect(result.current).toMatchObject({ status: "ready", plan: { kind: "plan" } });
  });

  it("aborts the first call when the request changes and shows only the second plan", async () => {
    const { result, rerender } = renderHook(({ request }) => usePlan(request), {
      initialProps: { request: REQUEST },
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ request: OTHER });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls[1]?.signal?.aborted).toBe(false);
    await act(async () => calls[1]?.respond(Response.json(LEVEL1_PLAN)));
    // The first answer arrives late and is ignored.
    await act(async () => calls[0]?.respond(Response.json(LEVEL3_PLAN)));
    expect(result.current).toMatchObject({ status: "ready", plan: { profile: { level: 1 } } });
  });

  it("does not refetch for an equal request object", async () => {
    const { rerender } = renderHook(({ request }) => usePlan(request), {
      initialProps: { request: REQUEST },
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ request: { ...REQUEST } });
    expect(calls).toHaveLength(1);
  });

  it("aborts on unmount", async () => {
    const { unmount } = renderHook(() => usePlan(REQUEST));
    await waitFor(() => expect(calls).toHaveLength(1));
    unmount();
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it("reports an abort as nothing", async () => {
    const { result, rerender } = renderHook(({ request }) => usePlan(request), {
      initialProps: { request: REQUEST as PlanRequest | null },
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ request: null });
    await act(async () => {});
    expect(result.current.status).toBe("idle");
  });

  it.each([
    [400, "invalid"],
    [503, "unavailable"],
    [500, "failed"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const { result } = renderHook(() => usePlan(REQUEST));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]?.respond(Response.json({ error: "x" }, { status })));
    expect(result.current).toEqual(expect.objectContaining({ status: "error", kind }));
  });

  it("maps a network error to failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    const { result } = renderHook(() => usePlan(REQUEST));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ kind: "failed" });
  });

  it("retry sends the request again", async () => {
    const { result } = renderHook(() => usePlan(REQUEST));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]?.respond(Response.json({}, { status: 503 })));
    expect(result.current.status).toBe("error");
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1]?.respond(Response.json(LEVEL3_PLAN)));
    expect(result.current.status).toBe("ready");
  });

  it("makes no call while offline and reports offline", async () => {
    setOnline(false);
    const { result } = renderHook(() => usePlan(REQUEST));
    await act(async () => {});
    expect(result.current).toMatchObject({ status: "error", kind: "offline" });
    expect(calls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retry while still offline stays offline without a call", async () => {
    setOnline(false);
    const { result } = renderHook(() => usePlan(REQUEST));
    await act(async () => {});
    act(() => result.current.retry());
    expect(result.current).toMatchObject({ status: "error", kind: "offline" });
    expect(calls).toHaveLength(0);
  });

  it("loads by itself when the connection returns", async () => {
    setOnline(false);
    const { result } = renderHook(() => usePlan(REQUEST));
    await act(async () => {});
    expect(result.current).toMatchObject({ kind: "offline" });
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]?.respond(Response.json(LEVEL3_PLAN)));
    expect(result.current.status).toBe("ready");
  });

  it("keeps a ready plan when the connection drops and returns", async () => {
    const { result } = renderHook(() => usePlan(REQUEST));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]?.respond(Response.json(LEVEL3_PLAN)));
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.status).toBe("ready");
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.status).toBe("ready");
    expect(calls).toHaveLength(1);
  });
});
