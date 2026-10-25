// Builds the body of POST /api/ask from what the screen holds, within the server's limits.
import type { AskRequest } from "@/ask/schema";
import type { PlanRequest } from "@/planner/schema";
import { ASK_LIMITS } from "@/ui/ask/limits";
import {
  type ChatMessage,
  type Holding,
  sanitizeHoldings,
  sanitizeMemory,
  truncate,
} from "@/ui/ask/stores";
import { readDraft, toRequest } from "@/ui/plan/draft";

export type AskBody = {
  lens: AskRequest["lens"];
  messages: ChatMessage[];
  profile?: { plan?: PlanRequest; holdings: Holding[]; memory: string[] };
};

export type AskInput = {
  messages: ChatMessage[];
  lens: AskRequest["lens"];
  holdings: Holding[];
  memory: string[];
  plan: PlanRequest | null;
};

type ProfileInput = Pick<AskInput, "holdings" | "memory" | "plan">;

const utf8Bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * The messages to send: non-empty, cut to the per-message limit, ending with the user's latest
 * question (the server rejects anything else), newest `maxMessages` only, then the oldest dropped
 * until their JSON fits `maxBytes` UTF-8 bytes, then any answer left at the front (some chat
 * templates reject a conversation that opens with the assistant). The last user message is kept
 * even if it alone is over the budget. CJK text is 3 bytes per character, so the byte size is
 * what counts.
 */
export function trimMessages(
  messages: ChatMessage[],
  opts: { maxMessages: number; maxBytes: number },
): ChatMessage[] {
  const clean = messages
    .filter((m) => m.content !== "")
    .map((m) => ({ role: m.role, content: truncate(m.content, ASK_LIMITS.maxMessageChars) }));
  while (clean.length > 0 && clean.at(-1)?.role !== "user") clean.pop();
  const kept = clean.slice(-opts.maxMessages);
  while (kept.length > 1 && utf8Bytes(kept) > opts.maxBytes) kept.shift();
  while (kept.length > 1 && kept[0]?.role === "assistant") kept.shift();
  return kept;
}

/**
 * The profile exactly as it would be sent, or undefined when there is nothing to send. Holdings
 * and notes pass through the same rules as the stored ones, so a caller's invalid entry is
 * dropped here instead of reaching the server as a 400.
 */
function profileOf(input: ProfileInput): AskBody["profile"] {
  const holdings = sanitizeHoldings(input.holdings);
  const memory = sanitizeMemory(input.memory);
  if (input.plan === null && holdings.length === 0 && memory.length === 0) return undefined;
  return input.plan === null ? { holdings, memory } : { plan: input.plan, holdings, memory };
}

export function buildAskBody(input: AskInput): AskBody {
  const profile = profileOf(input);
  const frame: AskBody = profile
    ? { lens: input.lens, messages: [], profile }
    : { lens: input.lens, messages: [] };
  // Everything but the messages counts against the budget; `[]` is already in the frame's size.
  const maxBytes = ASK_LIMITS.clientBodyBudget - (utf8Bytes(frame) - utf8Bytes([]));
  const messages = trimMessages(input.messages, { maxMessages: ASK_LIMITS.maxMessages, maxBytes });
  return { ...frame, messages };
}

/** The personal context a request carries besides the conversation: what is in it, not the values. */
export type ContextSummary = { plan: boolean; holdings: number; memory: number };

/** What a request body holds: counts read from the body itself, so they cannot drift from it. */
export function describeBody(body: AskBody): ContextSummary {
  return {
    plan: body.profile?.plan !== undefined,
    holdings: body.profile?.holdings.length ?? 0,
    memory: body.profile?.memory.length ?? 0,
  };
}

/**
 * What the summary says will leave the device besides the question itself: the profile as
 * `buildAskBody` would build it from the same inputs.
 */
export function describeOutgoing(input: ProfileInput & Partial<AskInput>): ContextSummary {
  const profile = profileOf(input);
  return describeBody({
    lens: input.lens ?? "beginner",
    messages: [],
    ...(profile && { profile }),
  });
}

/** The saved planner answers as a request: null unless the opt-in is on and the draft is complete. */
export function currentPlanRequest(optIn: boolean): PlanRequest | null {
  return optIn ? toRequest(readDraft()) : null;
}
