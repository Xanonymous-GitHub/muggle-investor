/**
 * The egress policy for arguments headed to an external capability (a search or MCP tool). Pure:
 * no server, db or env imports.
 *
 * The prompt asks the model to keep private data out of external calls; this module is what
 * enforces it. A call is allowed only when its arguments are small, shallow and made of public
 * material, and nothing in them can be read back to the user's private context:
 *
 * - shape: few short fields, a bounded depth, short plain keys (a key can carry data too);
 * - the tool's mode: `symbol` takes only ticker-shaped values, `topic` only short noun phrases,
 *   `free_text` a bounded sentence (the default);
 * - private numbers (amounts, quantities, plan figures, amounts the user wrote in chat), by the
 *   unit-expanding reader in `privacy.ts`; paging controls (`limit`, `count`, ...) are exempt;
 * - private text (saved notes, questionnaire answers, first-person statements about money,
 *   work or family from the chat): a long enough run copied from it is a leak;
 * - personal identifiers (email, phone, national ID, card and account numbers) whatever their
 *   origin.
 *
 * It is a defence against what a model does by accident or under injection, not a proof of
 * privacy. Known limits: a model can paraphrase a private sentence so that no run is shared, spell
 * a number out in a form the reader does not know, or split a secret across calls. Numeric matching
 * stays as defence in depth; the audit that counts is what the egress fake sees in the tests.
 */

import { TOPIC_MAX_CHARS } from "@/config/env";
import { argsLeakPrivateData } from "./privacy";
import { extractNumbers } from "./verify";

export type EgressMode = "free_text" | "topic" | "symbol";

export type EgressPolicy = {
  mode: EgressMode;
  /** Longest single text value. */
  maxChars: number;
};

export const DEFAULT_EGRESS_POLICY: EgressPolicy = { mode: "free_text", maxChars: 200 };

export type EgressReason =
  | "invalid_shape"
  | "oversize"
  | "not_public"
  | "private_number"
  | "private_text"
  | "pii";

export type EgressVerdict = { ok: true } | { ok: false; reason: EgressReason };

/** What the call must not reveal. The arrays are read at call time: the caller may extend them. */
export type PrivateContext = {
  numbers: readonly number[];
  texts: readonly string[];
  /** Symbols the user may search for (their holdings): stripped before text is compared. */
  publicSymbols?: ReadonlySet<string>;
};

/** Private numbers below this never block: they collide with ordinary arguments. */
export const EGRESS_MIN_PRIVATE_NUMBER = 100;

const MAX_FIELDS = 8;
const MAX_DEPTH = 3;
const MAX_ARRAY = 10;
const MAX_TOTAL_CHARS = 400;
const MAX_KEY_CHARS = 40;
const KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const SYMBOL = /^[0-9A-Za-z]{2,10}$/;
const TOPIC_MAX_WORDS = 8;
const SENTENCE_BREAK = /[。！？!?\n；;]/u;

/** Paging controls: a number under one of these is a count, not an amount. */
export const PAGING_KEYS: ReadonlySet<string> = new Set([
  "limit",
  "count",
  "page",
  "size",
  "top",
  "n",
  "k",
  "max",
  "offset",
  "num",
  "results",
  "num_results",
  "max_results",
  "page_size",
  "pagesize",
  "per_page",
  "top_k",
  "topk",
]);

const PII_PATTERNS: readonly RegExp[] = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  /(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/,
  /(?<![a-z])[a-z][12]\d{8}(?!\d)/i,
  /(?<!\d)\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}(?!\d)/,
  /(?<!\d)\d{10,}(?!\d)/,
];

const INVISIBLE = /[\u200b-\u200f\u2028\u2029\u2060\ufeff]/gu;
const CJK = /[⺀-鿿豈-﫿]/u;

/** Letters and digits only, lowercase, width-folded: the form two texts are compared in. */
export function squash(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** A run of this many characters copied from a private text is a leak. CJK is denser than Latin. */
const CJK_RUN = 6;
const LATIN_RUN = 12;
/** A private text this short only counts when the whole of it appears. */
const MIN_WHOLE_TEXT = 4;

/** Whether `text` repeats a run of `secret`, after both are squashed and public symbols removed. */
export function sharesRun(
  text: string,
  secret: string,
  publicSymbols?: ReadonlySet<string>,
): boolean {
  const strip = (value: string) => {
    let out = squash(value);
    for (const symbol of publicSymbols ?? []) out = out.replaceAll(squash(symbol), "");
    return out;
  };
  const hay = strip(text);
  const needle = strip(secret);
  if (needle.length < MIN_WHOLE_TEXT || hay.length < MIN_WHOLE_TEXT) return false;
  if (needle.length <= CJK_RUN) return hay.includes(needle);
  let windows = 0;
  for (let i = 0; i < needle.length; i++) {
    const run = CJK.test(needle[i] ?? "") ? CJK_RUN : LATIN_RUN;
    // A Latin start near the end has no room for its window, but a later CJK one still does.
    if (i + run > needle.length) continue;
    windows += 1;
    if (hay.includes(needle.slice(i, i + run))) return true;
  }
  // Too short for any window of its own script: only the whole of it counts.
  return windows === 0 && hay.includes(needle);
}

type Leaf = { key: string; value: string };

/** Every text leaf of the arguments, or the shape violation that stops the walk. */
function collectLeaves(args: unknown): { leaves: Leaf[] } | { reason: EgressReason } {
  const leaves: Leaf[] = [];
  let fields = 0;
  const bad = (reason: EgressReason) => ({ reason });
  const walk = (value: unknown, key: string, depth: number): EgressReason | null => {
    if (depth > MAX_DEPTH) return "invalid_shape";
    if (typeof value === "string") {
      leaves.push({ key, value });
      return null;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) return null;
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) return "oversize";
      for (const item of value) {
        const reason = walk(item, key, depth + 1);
        if (reason) return reason;
      }
      return null;
    }
    if (typeof value === "object") {
      for (const [name, item] of Object.entries(value)) {
        fields += 1;
        if (fields > MAX_FIELDS) return "oversize";
        if (name.length > MAX_KEY_CHARS || !KEY.test(name)) return "invalid_shape";
        const reason = walk(item, name, depth + 1);
        if (reason) return reason;
      }
      return null;
    }
    return "invalid_shape";
  };
  const reason = walk(args, "", 0);
  return reason ? bad(reason) : { leaves };
}

function modeViolation(leaf: Leaf, policy: EgressPolicy): EgressReason | null {
  const { value } = leaf;
  if (value.length > policy.maxChars) return "oversize";
  if (policy.mode === "symbol") return SYMBOL.test(value) ? null : "not_public";
  if (policy.mode === "topic") {
    if (value.length > TOPIC_MAX_CHARS || SENTENCE_BREAK.test(value)) return "not_public";
    if (value.trim().split(/\s+/u).length > TOPIC_MAX_WORDS) return "not_public";
  }
  return null;
}

/** Decides whether `args` may leave for an external capability under `policy`. */
export function screenEgress(
  args: unknown,
  ctx: PrivateContext,
  policy: EgressPolicy = DEFAULT_EGRESS_POLICY,
): EgressVerdict {
  const collected = collectLeaves(args);
  if ("reason" in collected) return { ok: false, reason: collected.reason };
  const { leaves } = collected;

  let total = 0;
  for (const leaf of leaves) {
    total += leaf.value.length;
    const violation = modeViolation(leaf, policy);
    if (violation) return { ok: false, reason: violation };
  }
  if (total > MAX_TOTAL_CHARS) return { ok: false, reason: "oversize" };

  for (const { value } of leaves) {
    const folded = value.normalize("NFKC").replace(INVISIBLE, "");
    if (PII_PATTERNS.some((pattern) => pattern.test(folded))) return { ok: false, reason: "pii" };
  }

  if (
    argsLeakPrivateData(args, ctx.numbers, {
      min: EGRESS_MIN_PRIVATE_NUMBER,
      exemptKeys: PAGING_KEYS,
    })
  ) {
    return { ok: false, reason: "private_number" };
  }

  for (const { value } of leaves) {
    if (ctx.texts.some((secret) => sharesRun(value, secret, ctx.publicSymbols))) {
      return { ok: false, reason: "private_text" };
    }
  }
  return { ok: true };
}

// ── What the chat itself reveals ────────────────────────────────────────────────────────────

const FIRST_PERSON = /我|本人|咱|自己/u;
const MONEY_CUE =
  /元|塊|萬|億|NT\$|TWD|\$|存款|本金|月薪|年薪|薪水|薪資|收入|資產|負債|貸款|房貸|欠|獎金|退休金|預算|成本|買在|投入/u;
const PERSONAL_CUE =
  /薪水|月薪|年薪|收入|存款|負債|貸款|房貸|欠|債|資產|淨值|退休|生病|癌|醫|離婚|失業|懷孕|老婆|老公|太太|先生|孩子|小孩|父母|家人|地址|住在|身分證|帳號|密碼|老闆|公司/u;
const MAX_SENSITIVE_CHARS = 200;
const MIN_CHAT_AMOUNT = 100;

/**
 * What the user's own messages reveal that should not leave: the amounts they wrote next to a
 * money word, and the first-person sentences about money, work, health or family. A heuristic;
 * the user's questions about public things pass untouched.
 */
export function sensitiveFromChat(messages: readonly { role: string; content: string }[]): {
  numbers: number[];
  texts: string[];
} {
  const numbers: number[] = [];
  const texts: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const raw of message.content.split(SENTENCE_BREAK)) {
      const sentence = raw.trim();
      if (sentence === "") continue;
      if (MONEY_CUE.test(sentence)) {
        for (const n of extractNumbers(sentence)) {
          if (Math.abs(n) >= MIN_CHAT_AMOUNT) numbers.push(Math.abs(n));
        }
      }
      if (FIRST_PERSON.test(sentence) && PERSONAL_CUE.test(sentence)) {
        texts.push([...sentence].slice(0, MAX_SENSITIVE_CHARS).join(""));
      }
    }
  }
  return { numbers, texts };
}
