import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A full-width strip under the header. The band carries the look (and the phone-only gap below
 * it); the inner box lines the text up with <main>. Callers render it inside an always-mounted
 * `role="status"` region, so an empty region has no styling and takes no space.
 */
export function NoticeBand({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("mb-3 py-2 text-sm md:mb-0", className)}>
      <div className="mx-auto max-w-6xl px-4 md:px-8">{children}</div>
    </div>
  );
}
