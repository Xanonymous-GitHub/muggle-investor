"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

// True while the history entry just before the current one is this page without a `?group=`, i.e.
// the detail was opened from the list in this session. A reload, a shared link or a switch from
// one sector to another leave it false.
let cameFromList = false;

/** Forgets how the current entry was reached. Tests call it between cases; the app never needs to. */
export function resetSelectionHistoryForTests(): void {
  cameFromList = false;
}

function urlWith(group: string | null): string {
  const url = new URL(window.location.href);
  if (group === null) url.searchParams.delete("group");
  else url.searchParams.set("group", group);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The sector named by `?group=`, a way to choose another and a way to leave it. Choosing writes
 * the url with `history.pushState`, which vinext (like Next) folds into `useSearchParams` without
 * a server round trip, so picking a row works offline and keeps the screen's local state. That
 * entry is also why the phone's Back button returns from the detail to the list.
 */
export function useSelectedGroup(): {
  selected: string | null;
  select(group: string): void;
  close(): void;
} {
  const selected = useSearchParams().get("group");

  // With no sector in the url (after Back, say) the list entry is the current one, so nothing is
  // left to pop. Without this a later link straight to `?group=X` would make 返回 leave the page.
  useEffect(() => {
    if (selected === null) cameFromList = false;
  }, [selected]);

  const select = useCallback((group: string) => {
    const current = new URL(window.location.href).searchParams.get("group");
    // Choosing what is already open must not stack a duplicate history entry.
    if (current === group) return;
    cameFromList = current === null;
    window.history.pushState(null, "", urlWith(group));
  }, []);

  const close = useCallback(() => {
    // Going back pops the entry the list pushed, so 返回 and Back end in the same place and the
    // history holds no list-detail-list loop. Without that entry (a shared link, a reload) there
    // is nothing to pop, so the url is rewritten in place instead.
    if (cameFromList) {
      cameFromList = false;
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", urlWith(null));
  }, []);

  return { selected, select, close };
}
