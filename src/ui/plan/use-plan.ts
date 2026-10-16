"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanRequest } from "@/planner/schema";
import type { PlanJson } from "@/ui/data/api";
import { postPlan } from "@/ui/data/post-plan";
import { useOnline } from "@/ui/shell/use-online";

export type PlanErrorKind = "invalid" | "unavailable" | "failed" | "offline";

export type PlanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; plan: PlanJson }
  | { status: "error"; kind: PlanErrorKind };

const IDLE: PlanState = { status: "idle" };
const LOADING: PlanState = { status: "loading" };
const OFFLINE: PlanState = { status: "error", kind: "offline" };

type Held = { key: string | null; generation: number; state: PlanState };

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

/**
 * The plan for one request. Keyed by the request's JSON, so an equal request object never
 * refetches (and the lens, which is not part of the request, never does). A new key aborts the
 * call in flight, and a response for an older key is ignored. Offline, nothing is sent: the state
 * is `offline` until the connection returns (a plan already held stays). `retry` sends again.
 */
export function usePlan(request: PlanRequest | null): PlanState & { retry(): void } {
  const online = useOnline();
  // Key order follows how the request is built (`toRequest`), so equal requests give equal keys.
  const key = request === null ? null : JSON.stringify(request);
  // One object per key: the effect below depends on it, not on the caller's object identity.
  const stable = useMemo(() => (key === null ? null : (JSON.parse(key) as PlanRequest)), [key]);
  const [generation, setGeneration] = useState(0);
  const [held, setHeld] = useState<Held>({
    key,
    generation: 0,
    state: key === null ? IDLE : LOADING,
  });
  const retry = useCallback(() => setGeneration((g) => g + 1), []);
  // The latest held state, for the effect below to read without depending on it.
  const heldNow = useRef(held);
  heldNow.current = held;

  useEffect(() => {
    if (stable === null || key === null) {
      setHeld({ key: null, generation, state: IDLE });
      return;
    }
    // This key and generation already hold their plan: coming back online needs no second request.
    const have = (h: Held) =>
      h.key === key && h.generation === generation && h.state.status === "ready";
    if (!online) {
      setHeld((prev) => (have(prev) ? prev : { key, generation, state: OFFLINE }));
      return;
    }
    if (have(heldNow.current)) return;
    let current = true;
    const controller = new AbortController();
    setHeld({ key, generation, state: LOADING });
    postPlan(stable, { signal: controller.signal }).then(
      (result) => {
        if (!current) return;
        setHeld({
          key,
          generation,
          state: result.ok
            ? { status: "ready", plan: result.plan }
            : { status: "error", kind: result.kind },
        });
      },
      (error: unknown) => {
        // An abort means the caller moved on; nothing failed.
        if (!current || isAbort(error)) return;
        setHeld({ key, generation, state: { status: "error", kind: "failed" } });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [stable, key, generation, online]);

  // A render for a new key never shows the old key's state before the effect catches up.
  const state = held.key === key ? held.state : key === null ? IDLE : LOADING;
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
