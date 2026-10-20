"use client";

import { useSyncExternalStore } from "react";
import { getUpdateReady, reloadPage, subscribeUpdate } from "@/ui/pwa/update";

/** The server snapshot is false so server HTML and the first client render agree. */
export function useUpdateAvailable(): { ready: boolean; reload: () => void } {
  const ready = useSyncExternalStore(subscribeUpdate, getUpdateReady, () => false);
  return { ready, reload: reloadPage };
}
