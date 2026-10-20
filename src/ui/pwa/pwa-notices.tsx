"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PWA_COPY } from "@/ui/pwa/copy";
import { dismissInstall, isInstallDismissed } from "@/ui/pwa/install";
import { useInstallPrompt } from "@/ui/pwa/use-install-prompt";
import { useUpdateAvailable } from "@/ui/pwa/use-update-available";

/** The shell's notices: a new version first, then the dismissible install offer. */
export function PwaNotices() {
  return (
    <>
      <UpdateNotice />
      <InstallNotice />
    </>
  );
}

// Not dismissible and never reloads by itself: a streaming answer or an unsent draft would be
// lost, so when to reload is the user's choice.
function UpdateNotice() {
  const { ready, reload } = useUpdateAvailable();
  if (!ready) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-4 py-2 text-sm"
    >
      <p className="min-w-0 flex-1 basis-60">{PWA_COPY.update.message}</p>
      <Button type="button" className="min-h-11 px-4" onClick={reload}>
        {PWA_COPY.update.button}
      </Button>
    </div>
  );
}

function InstallNotice() {
  const { mode, install } = useInstallPrompt();
  // The notice never renders on the server (mode is "none" there), so reading storage here
  // cannot cause a hydration mismatch.
  const [dismissed, setDismissed] = useState(() => isInstallDismissed());

  // install() has already stored a native decline; hide the notice for the rest of this page too.
  const onInstall = async () => {
    if ((await install()) === "dismissed") setDismissed(true);
  };

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
          <Button type="button" className="min-h-11 px-4" onClick={onInstall}>
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
