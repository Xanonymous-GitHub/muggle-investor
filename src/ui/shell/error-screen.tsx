"use client";

import { Button } from "@/components/ui/button";
import { clearCache } from "@/ui/data/resource-cache";

/**
 * Shown by the app's error boundary when a screen fails to render. Reloading first drops the
 * cached responses, so a cached body the screen cannot read is fetched afresh instead of
 * failing the same way again.
 */
export function ErrorScreen({ reset }: { reset(): void }) {
  const reload = () => {
    clearCache();
    reset();
  };
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-lg flex-col items-start gap-3 rounded-xl border bg-card p-4"
    >
      <p className="text-base font-bold">畫面出了點問題。</p>
      <Button onClick={reload}>重新載入</Button>
    </div>
  );
}
