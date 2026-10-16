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
  const key = request === null ? null : JSON.stringify(request);
  // One object per key: the effect below depends on it, not on the caller's object identity.
  const stable = useMemo(() => (key === null ? null : (JSON.parse(key) as PlanRequest)), [key]);
  const [held, setHeld] = useState<{ key: string | null; state: PlanState }>({
    key,
    state: key === null ? IDLE : LOADING,
  });
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration((g) => g + 1), []);
  // The key and generation of the last request that succeeded: coming back online then needs no
  // second request.
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (stable === null || key === null) {
      setHeld({ key: null, state: IDLE });
      return;
    }
    const tag = `${generation}:${key}`;
    if (!online) {
      setHeld((prev) =>
        loaded.current === tag && prev.key === key ? prev : { key, state: OFFLINE },
      );
      return;
    }
    if (loaded.current === tag) return;
    let current = true;
    const controller = new AbortController();
    setHeld({ key, state: LOADING });
    postPlan(stable, { signal: controller.signal }).then(
      (result) => {
        if (!current) return;
        if (result.ok) loaded.current = tag;
        setHeld({
          key,
          state: result.ok
            ? { status: "ready", plan: result.plan }
            : { status: "error", kind: result.kind },
        });
      },
      (error: unknown) => {
        // An abort means the caller moved on; nothing failed.
        if (!current || isAbort(error)) return;
        setHeld({ key, state: { status: "error", kind: "failed" } });
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
