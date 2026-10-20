"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PWA_COPY } from "@/ui/pwa/copy";
import { dismissInstall, isInstallDismissed } from "@/ui/pwa/install";
import { useInstallPrompt } from "@/ui/pwa/use-install-prompt";

/** The shell's dismissible notices: install now, "new version" after Task 2. */
export function PwaNotices() {
  return <InstallNotice />;
}

function InstallNotice() {
  const { mode, install } = useInstallPrompt();
  // The notice never renders on the server (mode is "none" there), so reading storage here
  // cannot cause a hydration mismatch.
  const [dismissed, setDismissed] = useState(() => isInstallDismissed());

  if (dismissed || (mode !== "prompt" && mode !== "ios")) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-4 py-2 text-sm"
    >
      <p className="min-w-0 flex-1 basis-60">
        {PWA_COPY.install.message}
        {mode === "ios" ? (
          <span className="block text-muted-foreground">{PWA_COPY.install.iosHowTo}</span>
        ) : null}
      </p>
      <div className="flex gap-2">
        {mode === "prompt" ? (
          <Button type="button" className="min-h-11 px-4" onClick={() => void install()}>
            {PWA_COPY.install.button}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 px-4"
          onClick={() => {
            dismissInstall();
            setDismissed(true);
          }}
        >
          {PWA_COPY.install.later}
        </Button>
      </div>
    </div>
  );
}
