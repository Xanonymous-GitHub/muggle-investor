/**
 * The model request of one Ask run, assembled from separate parts and fitted to a token budget.
 * Pure: no server, db or env imports.
 *
 * The parts, in the order of authority they have:
 * - the system prompt (policy, tool rules, playbook catalogue): built elsewhere, never trimmed;
 * - the current question (the last message): never cut;
 * - the user's own profile (plan, holdings, saved notes) as one private note: unverified-by-nature
 *   context the user chose to give, subordinate to what they say now;
 * - the earlier messages: the client's copy of the conversation. Assistant messages in it are
 *   unverified history (the server keeps no record of what it said), and nothing in it is evidence.
 *
 * The budget covers the whole request, not only the messages: the system prompt, the tool
 * definitions, the output the model may produce and the tool results it may collect are all
 * reserved first. What is left goes, in this order, to the current question, the profile essentials
 * (plan, holdings), the saved notes that best match the question, and the newest earlier messages.
 * Whatever does not fit is dropped oldest-first and reported, never summarized (a summary is a
 * model-written paraphrase nobody could check).
 *
 * `estimateTokens` is a deliberately conservative count, not a tokenizer: it overcounts, so a
 * request trims a little early rather than hit the provider's context limit after output began.
 */
import { asSchema, type ModelMessage, type ToolSet } from "ai";
import { squash } from "./egress";
import { buildContextNote } from "./prompts/ask";
import type { AskRequest } from "./schema";

/** Traditional Chinese costs about 1-2 tokens per character in common tokenizers; take 1.5. */
export const CJK_TOKENS_PER_CHAR = 1.5;
/** Latin text, digits and JSON punctuation: about 0.25-0.4 per character; take the top. */
export const OTHER_TOKENS_PER_CHAR = 0.4;
/** Role markers and message framing, per message. */
export const MESSAGE_OVERHEAD_TOKENS = 6;
/** A serialized tool result mixes CJK and ASCII; one token per this many bytes, conservatively. */
export const BYTES_PER_RESULT_TOKEN = 3;
/** The fraction of what is left after the profile essentials that saved notes may take. */
const NOTES_SHARE = 0.25;
/** Used when a tool's schema cannot be serialized. */
const UNKNOWN_TOOL_TOKENS = 400;

/** CJK radicals through unified ideographs (this covers kana and CJK punctuation), compatibility ideographs, full-width forms. */
const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u;

/** A conservative estimate of the tokens `text` costs. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (CJK.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk * CJK_TOKENS_PER_CHAR + other * OTHER_TOKENS_PER_CHAR);
}

/** The tokens the tool definitions (name, description, input schema) add to every request. */
export function estimateToolTokens(tools: ToolSet): number {
  let total = 0;
  for (const [name, definition] of Object.entries(tools)) {
    try {
      const schema = JSON.stringify(asSchema(definition.inputSchema).jsonSchema);
      total += estimateTokens(`${name}${definition.description ?? ""}${schema}`);
    } catch {
      total += UNKNOWN_TOOL_TOKENS;
    }
  }
  return total;
}

/** The tokens a budget of serialized tool-result bytes may take. */
export const resultTokens = (bytes: number): number => Math.ceil(bytes / BYTES_PER_RESULT_TOKEN);

export type ContextBudget = {
  /** The whole request, the reserved output and the reserved tool results included. */
  contextTokens: number;
  /** Reserved for what the model writes (every step may write this much). */
  outputTokens: number;
  /** Reserved for tool results: only when the run has tools. */
  resultBytes: number;
};

export type ContextInput = {
  profile: AskRequest["profile"];
  messages: AskRequest["messages"];
  /** The finished system prompt of this run. */
  system: string;
  /** The tools of this run (none for a run without tools). */
  tools: ToolSet;
  /**
   * Reserve room for tool results although `tools` is empty: the answer that folds results already
   * collected into the prompt as text. Default: reserve when there are tools.
   */
  reserveResults?: boolean;
  budget: ContextBudget;
};

export type BuiltContext = {
  /** The private note (when the profile has anything left) followed by the kept messages. */
  messages: ModelMessage[];
  /** Earlier messages left out (the oldest ones). */
  droppedMessages: number;
  /** Saved notes left out because they did not fit or matched the question least. */
  droppedNotes: number;
  /** The plan and holdings had to be left out too: nothing else fitted. */
  droppedProfile: boolean;
  /** The estimate for the whole request, reserved output and tool results included. */
  estimatedTokens: number;
  /** False when even the current question did not fit the budget (it is sent anyway). */
  fitted: boolean;
};

/** Distinct character bigrams of the squashed text. */
function bigrams(text: string): Set<string> {
  const flat = squash(text);
  const out = new Set<string>();
  for (let i = 0; i + 1 < flat.length; i++) out.add(flat.slice(i, i + 2));
  return out;
}

/** How many bigrams of `note` the question shares: a rough measure of "this note is about that". */
function overlap(note: string, question: Set<string>): number {
  let shared = 0;
  for (const pair of bigrams(note)) if (question.has(pair)) shared += 1;
  return shared;
}

/**
 * The saved notes that fit in `maxTokens`, in their original order. Notes closest to the question
 * come first, then the most recent; when every note fits, every note is kept.
 */
export function selectNotes(
  notes: readonly string[],
  question: string,
  maxTokens: number,
): { kept: string[]; dropped: number } {
  const costs = notes.map((note) => estimateTokens(note) + 4);
  if (costs.reduce((sum, cost) => sum + cost, 0) <= maxTokens) {
    return { kept: [...notes], dropped: 0 };
  }
  const asked = bigrams(question);
  const ranked = notes
    .map((note, index) => ({ index, score: overlap(note, asked) }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const chosen = new Set<number>();
  let spent = 0;
  for (const { index } of ranked) {
    const cost = costs[index] ?? 0;
    if (spent + cost > maxTokens) continue;
    spent += cost;
    chosen.add(index);
  }
  const kept = notes.filter((_, index) => chosen.has(index));
  return { kept, dropped: notes.length - kept.length };
}

const messageTokens = (message: { content: string }): number =>
  estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS;

export function buildRequestContext(input: ContextInput): BuiltContext {
  const { profile, messages, system, tools, budget } = input;
  const current = messages.at(-1);
  const earlier = messages.slice(0, -1);
  const reservesResults = input.reserveResults ?? Object.keys(tools).length > 0;

  const reserved =
    estimateTokens(system) +
    estimateToolTokens(tools) +
    budget.outputTokens +
    (reservesResults ? resultTokens(budget.resultBytes) : 0);
  const currentCost = current ? messageTokens(current) : 0;
  const room = budget.contextTokens - reserved - currentCost;
  const fitted = room >= 0;

  // Profile essentials (plan, holdings) first; the notes get a share of what is left.
  const essentials = { ...profile, memory: [] };
  const essentialsNote = buildContextNote({ profile: essentials });
  const essentialsCost = essentialsNote === null ? 0 : estimateTokens(essentialsNote);
  const keepProfile = essentialsCost <= room;
  const afterEssentials = keepProfile ? room - essentialsCost : room;

  const question = current?.content ?? "";
  const notes = keepProfile
    ? selectNotes(
        profile.memory,
        question,
        Math.max(0, Math.floor(Math.max(0, afterEssentials) * NOTES_SHARE)),
      )
    : { kept: [], dropped: profile.memory.length };
  const note = keepProfile
    ? buildContextNote({ profile: { ...profile, memory: notes.kept } })
    : null;
  const noteCost = note === null ? 0 : estimateTokens(note);

  // The newest earlier messages that fit, as one contiguous run: a gap in the middle of a
  // conversation would pair answers with the wrong questions.
  let historyRoom = room - noteCost;
  let start = earlier.length;
  while (start > 0) {
    const cost = messageTokens(earlier[start - 1] as { content: string });
    if (cost > historyRoom) break;
    historyRoom -= cost;
    start -= 1;
  }
  // A conversation starts with the user: an orphaned assistant reply at the front is dropped too.
  while (start < earlier.length && earlier[start]?.role === "assistant") start += 1;
  const kept = earlier.slice(start);

  const out: ModelMessage[] = [
    ...(note === null ? [] : [{ role: "user" as const, content: note }]),
    ...kept,
    ...(current ? [current] : []),
  ];
  const used = out.reduce((sum, message) => sum + messageTokens(message as { content: string }), 0);
  return {
    messages: out,
    droppedMessages: start,
    droppedNotes: notes.dropped,
    droppedProfile: !keepProfile && essentialsNote !== null,
    estimatedTokens: reserved + used,
    fitted,
  };
}

/** Whether anything was left out, for the reader's notice and the log. */
export const wasTrimmed = (context: BuiltContext): boolean =>
  context.droppedMessages > 0 || context.droppedNotes > 0 || context.droppedProfile;
