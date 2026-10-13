"use client";

import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { type FetchFailure, type LoadResult, loadResource } from "@/ui/data/load-resource";
import { CACHE_VERSION, readCache, writeCache } from "@/ui/data/resource-cache";

export type ResourceState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      data: T;
      dataDate: string | null;
      fromCache: boolean;
      savedAt: string | null;
      /** The last fetch failed, so what is shown is the cached copy and is not being refreshed. */
      refreshFailed: boolean;
    }
  | { status: "error"; kind: FetchFailure; retryAfterSeconds: number | null };

type Fetched = LoadResult<unknown> & { savedAt?: string };

// One request per url at a time: StrictMode's double effect and two screens asking for the same
// url share it, so upstream-budgeted routes are not hit twice. Successful bodies are cached here,
// once, even when every consumer has gone away by the time the response lands.
const inFlight = new Map<string, Promise<Fetched>>();

function fetchShared(url: string): Promise<Fetched> {
  const existing = inFlight.get(url);
  if (existing) return existing;
  const request = loadResource<unknown>(url).then((result): Fetched => {
    inFlight.delete(url);
    if (!result.ok) return result;
    const savedAt = new Date().toISOString();
    writeCache(url, { v: CACHE_VERSION, savedAt, dataDate: result.dataDate, body: result.body });
    return { ...result, savedAt };
  });
  inFlight.set(url, request);
  return request;
}

const IDLE: ResourceState<never> = { status: "idle" };
const LOADING: ResourceState<never> = { status: "loading" };

/**
 * Stale-while-revalidate for one GET route. Shows the cached entry at once (`fromCache: true`),
 * then the fresh response; a failed fetch keeps whatever data is already shown. A response
 * for a url that is no longer current, or that lands after unmount, is ignored.
 */
export function useResource<T>(url: string | null): ResourceState<T> & { reload(): void } {
  // State is tagged with the url it belongs to, so a render for a new url never shows the old
  // url's data in the moment before the effect below catches up.
  const [held, setHeld] = useState<{ url: string | null; state: ResourceState<T> }>({
    url,
    state: url === null ? IDLE : LOADING,
  });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  // A layout effect so the cached entry replaces "loading" before the browser paints, while the
  // server render and hydration (where localStorage is out of reach) still agree on "loading".
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the reload trigger.
  useLayoutEffect(() => {
    if (url === null) {
      setHeld({ url, state: IDLE });
      return;
    }
    let current = true;
    setHeld((prev) => {
      // A reload keeps the data on screen while it refetches.
      if (prev.url === url && prev.state.status === "ready") return prev;
      const cached = readCache<T>(url);
      return {
        url,
        state: cached
          ? {
              status: "ready",
              data: cached.body,
              dataDate: cached.dataDate,
              fromCache: true,
              savedAt: cached.savedAt,
              refreshFailed: false,
            }
          : LOADING,
      };
    });
    fetchShared(url).then((result) => {
      if (!current) return;
      setHeld((prev) => {
        if (result.ok) {
          const state: ResourceState<T> = {
            status: "ready",
            data: result.body as T,
            dataDate: result.dataDate,
            fromCache: false,
            savedAt: result.savedAt ?? null,
            refreshFailed: false,
          };
          return { url, state };
        }
        if (prev.url === url && prev.state.status === "ready") {
          return { url, state: { ...prev.state, fromCache: true, refreshFailed: true } };
        }
        const { kind, retryAfterSeconds } = result;
        return { url, state: { status: "error", kind, retryAfterSeconds } };
      });
    });
    return () => {
      current = false;
    };
  }, [url, generation]);

  let state = held.state;
  if (held.url !== url) state = url === null ? IDLE : LOADING;
  return useMemo(() => ({ ...state, reload }), [state, reload]);
}
