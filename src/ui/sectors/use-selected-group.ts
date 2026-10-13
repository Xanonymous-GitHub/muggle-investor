"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * The sector named by `?group=` and a way to choose another. Choosing writes the url with
 * `history.pushState`, which vinext (like Next) folds into `useSearchParams` without a server
 * round trip, so picking a row works offline and keeps the screen's local state.
 */
export function useSelectedGroup(): { selected: string | null; select(group: string): void } {
  const selected = useSearchParams().get("group");
  const select = useCallback((group: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("group", group);
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return { selected, select };
}
