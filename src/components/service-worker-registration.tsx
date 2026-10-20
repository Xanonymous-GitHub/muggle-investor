"use client";

import { useEffect } from "react";
import { publishRegistration } from "@/ui/pwa/update";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(publishRegistration)
      .catch((error: unknown) => {
        console.error("Service worker registration failed", error);
      });
  }, []);
  return null;
}
