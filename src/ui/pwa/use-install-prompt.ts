"use client";

import { useSyncExternalStore } from "react";
import {
  getInstallMode,
  type InstallMode,
  type InstallOutcome,
  promptInstall,
  subscribeInstall,
} from "@/ui/pwa/install";

export type { InstallMode, InstallOutcome };

/** The server snapshot is "none" so server HTML and the first client render agree. */
export function useInstallPrompt(): {
  mode: InstallMode;
  install: () => Promise<InstallOutcome>;
} {
  const mode = useSyncExternalStore(subscribeInstall, getInstallMode, (): InstallMode => "none");
  return { mode, install: promptInstall };
}
