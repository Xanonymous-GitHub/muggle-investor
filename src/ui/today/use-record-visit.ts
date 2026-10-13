"use client";

import { useEffect, useRef } from "react";
import { writeLastSeen } from "@/ui/device/last-seen";

/**
 * Remembers the trade date shown as last seen when the visit ends: on pagehide, when the page is
 * hidden, and on unmount. Never during the visit, so the away tab does not vanish while it is
 * read, and never for a null date, when nothing was shown.
 */
export function useRecordVisit(latestTradeDate: string | null): void {
  const latest = useRef(latestTradeDate);
  useEffect(() => {
    latest.current = latestTradeDate;
  }, [latestTradeDate]);

  useEffect(() => {
    const record = () => {
      if (latest.current !== null) writeLastSeen(latest.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") record();
    };
    window.addEventListener("pagehide", record);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", record);
      document.removeEventListener("visibilitychange", onVisibility);
      record();
    };
  }, []);
}
