import { ASK_COPY } from "@/ui/ask/copy";
import type { ContextSummary } from "@/ui/ask/request";

/** The parts of a context summary as words, only those that are in it (counts, never values). */
export function contextParts(context: ContextSummary): string[] {
  const parts: string[] = [];
  if (context.plan) parts.push(ASK_COPY.context.plan);
  if (context.holdings > 0) parts.push(ASK_COPY.context.holdings(context.holdings));
  if (context.memory > 0) parts.push(ASK_COPY.context.memory(context.memory));
  return parts;
}

/** `規劃答案 · 2 檔持股`, or null when the context holds nothing. */
export function contextLine(context: ContextSummary): string | null {
  const parts = contextParts(context);
  return parts.length === 0 ? null : parts.join(" · ");
}
