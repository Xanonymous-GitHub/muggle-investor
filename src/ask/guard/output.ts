// The Ask output tripwire: a deterministic check on the text as it streams, with no model call. It
// is the second line behind the input gate and the prompt, and it exists for the cases they miss:
// a message that mixes an investing question with a request for code, or an answer that starts to
// recite the system prompt.
//
// A streamed answer cannot be taken back once it has been shown, so the check works on a short
// holdback window: the last HOLD characters are kept until more text arrives (or the segment
// ends, however it ends). Anything a rule matches therefore sits inside text that has not been
// released, and the reader never sees it. The text before the match stays, as it was going to be
// shown anyway. The price is that the first HOLD characters of an answer appear only once more
// text follows: a few tokens of delay, not a buffered answer.
//
// Rules, kept to ones that essentially never fire on a finance answer:
// - a code fence that names a language, or code that is plain (`#include <`, `int main(`, ...);
// - a run of the system prompt itself (SHINGLE characters, whitespace ignored).
export type OutputViolation = "code" | "prompt_leak";

/** Characters held back. Must exceed the longest match, counting the whitespace a match may span. */
const HOLD = 48;
/** A run of this many characters (whitespace removed) of the system prompt, repeated, is a leak. */
const SHINGLE = 20;

const FENCE_WITH_LANGUAGE = /(?:```|~~~)[ \t]*[A-Za-z][\w+#.-]*/;
const CODE_SIGNALS = [
  /#include\s*</,
  /\bint\s+main\s*\(/,
  // The keyword and the first letter of the name: a rule must complete inside the holdback, so a
  // whole signature (arguments of any length) cannot be the pattern.
  /\bdef[ \t]+[A-Za-z_]/,
  /\bpublic\s+static\s+void\s+main\b/,
  /\bconsole\.log\s*\(/,
  /\bstd::\w+/,
  /\bSystem\.out\.print/,
  /\bimport\s+(?:numpy|pandas|requests)\b/,
];

const squash = (text: string): string => text.replace(/\s+/g, "");

/** Where in `text` its `flatIndex`-th non-whitespace character sits. */
function rawIndex(text: string, flatIndex: number): number {
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i] ?? "")) continue;
    if (seen === flatIndex) return i;
    seen += 1;
  }
  return text.length;
}

/** Every SHINGLE-character window of `text`, whitespace removed. */
function shinglesOf(text: string): Set<string> {
  const flat = squash(text);
  const set = new Set<string>();
  for (let i = 0; i + SHINGLE <= flat.length; i++) set.add(flat.slice(i, i + SHINGLE));
  return set;
}

/**
 * `release` is what may be shown now and may be empty (everything is still in the holdback). With a
 * violation it is the text before the match, which is as safe as any text already shown.
 */
export type OutputPush = { violation?: OutputViolation; release: string };

export type OutputGuard = {
  /** Adds the system prompt (or any text) whose recital counts as a leak. */
  protect(text: string): void;
  /** Feeds the next piece of answer text. After a violation, nothing more is ever released. */
  push(delta: string): OutputPush;
  /** The held-back tail, at the end of a text segment. Empty after a violation. */
  flush(): string;
};

export function createOutputGuard(): OutputGuard {
  const shingles = new Set<string>();
  let held = "";
  let tripped: OutputViolation | null = null;

  /** The first rule that matches `text`, and where in `text` the match starts. */
  const violationIn = (text: string): { kind: OutputViolation; at: number } | null => {
    let code: number | null = null;
    for (const rule of [FENCE_WITH_LANGUAGE, ...CODE_SIGNALS]) {
      const at = text.search(rule);
      if (at >= 0 && (code === null || at < code)) code = at;
    }
    let leak: number | null = null;
    if (shingles.size > 0) {
      const flat = squash(text);
      for (let i = 0; i + SHINGLE <= flat.length; i++) {
        if (shingles.has(flat.slice(i, i + SHINGLE))) {
          leak = rawIndex(text, i);
          break;
        }
      }
    }
    if (code === null && leak === null) return null;
    return code !== null && (leak === null || code <= leak)
      ? { kind: "code", at: code }
      : { kind: "prompt_leak", at: leak ?? 0 };
  };

  return {
    protect(text) {
      for (const shingle of shinglesOf(text)) shingles.add(shingle);
    },
    push(delta) {
      if (tripped !== null) return { violation: tripped, release: "" };
      const window = held + delta;
      const found = violationIn(window);
      if (found !== null) {
        tripped = found.kind;
        held = "";
        return { violation: found.kind, release: window.slice(0, found.at) };
      }
      // Cut on code points, so a surrogate pair is never split.
      const chars = [...window];
      const keep = Math.min(HOLD, chars.length);
      held = chars.slice(chars.length - keep).join("");
      return { release: chars.slice(0, chars.length - keep).join("") };
    },
    flush() {
      const rest = tripped === null ? held : "";
      held = "";
      return rest;
    },
  };
}
