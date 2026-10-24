// The optional last line of an answer that offers to remember something, and whether the user's
// own words support it. Pure: the answer view and the server both use it.

/** The exact prefix of the optional last line, with a full-width colon. */
const REMEMBER_PREFIX = "要不要我記住：";
const MAX_REMEMBER_CHARS = 200;
/** Invisible characters (zero-width space, joiners, direction marks, word joiner, BOM, soft hyphen, hangul filler) that must not make up or pad a fact. */
const ZERO_WIDTH = /[​-‏⁠﻿­ㅤ]/g;

/**
 * Splits off the optional 「要不要我記住：…」 line. Strict on purpose: it counts only as the last
 * non-empty line, starting exactly with the prefix (no bold, list, quote or 「」 around it, no
 * leading space), followed by a plain fact of 1..200 characters. Anything else stays in the body,
 * so a model that dresses the line up gets no memory card.
 */
export function splitRememberLine(text: string): { body: string; remember: string | null } {
  const lines = text.split(/\r\n?|\n/);
  let last = lines.length - 1;
  while (last >= 0 && (lines[last] ?? "").trim() === "") last -= 1;
  const line = last >= 0 ? (lines[last] ?? "") : "";
  if (!line.startsWith(REMEMBER_PREFIX)) return { body: text, remember: null };
  const fact = line.slice(REMEMBER_PREFIX.length).replace(ZERO_WIDTH, "").trim();
  // `.length` counts UTF-16 units, the same as the server's `z.string().max(200)`.
  if (fact.length < 1 || fact.length > MAX_REMEMBER_CHARS) return { body: text, remember: null };
  return { body: lines.slice(0, last).join("\n").trimEnd(), remember: fact };
}

const squash = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

const grams = (text: string, size: number): string[] => {
  if (text.length <= size) return text === "" ? [] : [text];
  const out: string[] = [];
  for (let i = 0; i + size <= text.length; i++) out.push(text.slice(i, i + size));
  return out;
};

const FIRST_PERSON = /我|本人|咱|自己/u;
const SENTENCE_BREAK = /[。！？!?\n；;]/u;
const QUOTED = /「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/gu;
/** A message this long is more likely a pasted article than the user's own statement. */
const LONG_MESSAGE_CHARS = 300;
const SUBJECT_WORDS = /^(使用者|用戶|你|您)(說|表示|提到|想)?/u;
const MIN_BIGRAM_SHARE = 0.5;

/**
 * Whether the user's own words support a fact the answer offers to remember. The memory rule is
 * that only something the user said themselves may be offered; an assistant inference, a line
 * from a search result or a passage the user pasted is not theirs. Checked on the server, where the
 * messages are, and sent as a flag; the person still decides on the card.
 *
 * Supporting text is what is left of the user's messages after quoted passages are removed, and,
 * in a long message, only the sentences that speak in the first person. The fact is supported when
 * at least half of its character pairs and one character triple occur in that text and every
 * number and Latin word in it does too (so a made-up account name or amount never passes). A
 * heuristic: a loose paraphrase of what the user said may be refused, which only costs the card.
 */
export function rememberSupportedByUser(
  fact: string,
  messages: readonly { role: string; content: string }[],
): boolean {
  const supporting: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const unquoted = message.content.replace(QUOTED, " ");
    const long = unquoted.length >= LONG_MESSAGE_CHARS;
    for (const sentence of unquoted.split(SENTENCE_BREAK)) {
      if (long && !FIRST_PERSON.test(sentence)) continue;
      supporting.push(sentence);
    }
  }
  const hay = squash(supporting.join(" "));
  if (hay === "") return false;

  const needle = squash(fact.replace(SUBJECT_WORDS, ""));
  if (needle === "") return false;
  const pairs = grams(needle, 2);
  const shared = pairs.filter((pair) => hay.includes(pair)).length;
  if (pairs.length === 0 || shared / pairs.length < MIN_BIGRAM_SHARE) return false;
  if (needle.length >= 3 && !grams(needle, 3).some((triple) => hay.includes(triple))) return false;

  const tokens =
    fact
      .normalize("NFKC")
      .toLowerCase()
      .match(/[a-z]{3,}|\d+(?:[.,]\d+)*/gu) ?? [];
  return tokens.every((token) => hay.includes(token.replace(/,/g, "")));
}
