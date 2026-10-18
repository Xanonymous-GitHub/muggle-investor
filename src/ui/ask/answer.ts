// Pure helpers for reading an Ask answer. Nothing here renders; the view and the chat screen
// import these, and the parsing rules are pinned by answer.test.ts.

/** The exact prefix of the optional last line, with a full-width colon. */
const REMEMBER_PREFIX = "要不要我記住：";
const MAX_REMEMBER_CHARS = 200;

/**
 * Splits off the optional 「要不要我記住：…」 line. Strict on purpose: it counts only as the last
 * non-empty line, starting exactly with the prefix (no bold, list, quote or 「」 around it, no
 * leading space), followed by a plain fact of 1..200 characters. Anything else stays in the body,
 * so a model that dresses the line up gets no memory card.
 */
export function splitRememberLine(text: string): { body: string; remember: string | null } {
  const lines = text.split(/\r?\n/);
  let last = lines.length - 1;
  while (last >= 0 && (lines[last] ?? "").trim() === "") last -= 1;
  const line = last >= 0 ? (lines[last] ?? "") : "";
  if (!line.startsWith(REMEMBER_PREFIX)) return { body: text, remember: null };
  const fact = line.slice(REMEMBER_PREFIX.length).trim();
  // `.length` counts UTF-16 units, the same as the server's `z.string().max(200)`.
  if (fact.length < 1 || fact.length > MAX_REMEMBER_CHARS) return { body: text, remember: null };
  return { body: lines.slice(0, last).join("\n").trimEnd(), remember: fact };
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  getMarketToday: "今日行情",
  getSectorBoard: "族群",
  lookupTerm: "名詞",
  getInstrumentHistory: "個股歷史",
  getMyPlan: "你的規劃",
  getLatestBriefing: "最新簡報",
  loadSkill: "分析手冊",
};
const WEB_LABEL = "查網路";

/** The Chinese name of a built-in tool; every external (MCP, `__`-named) or unknown tool is 查網路. */
export function toolLabel(name: string): string {
  if (name.includes("__")) return WEB_LABEL;
  return Object.hasOwn(TOOL_LABELS, name) ? (TOOL_LABELS[name] ?? WEB_LABEL) : WEB_LABEL;
}

/** The section titles the answer prompt asks for, each on a line of its own as `**<title>**`. */
export const HEADINGS = [
  "結論",
  "依據",
  "情境",
  "對你的意義",
  "建議",
  "一般選項",
  "信心程度",
] as const;

export function isHeadingLine(line: string): boolean {
  return HEADINGS.some((heading) => line === `**${heading}**`);
}

const MAX_URL_CHARS = 2048;

/**
 * The normalized href of a link the answer may open, or null. Only absolute http(s) URLs with a
 * host and no user:password@ part pass; `javascript:`, `data:`, `mailto:`, `//host` and relative
 * paths do not. Whatever the model wrote, the anchor gets the URL parser's own normalized form.
 */
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_CHARS) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname === "" || parsed.username !== "" || parsed.password !== "") return null;
  // The URL parser forgives `https:///x`, `https:\\x` and `https://@x`; the written form must be
  // a plain `scheme://host…` so what the reader sees is what the browser opens.
  const authority = /^https?:\/\/([^/\\?#]+)/i.exec(trimmed)?.[1];
  if (authority === undefined || authority.includes("@")) return null;
  return parsed.href;
}

/** The host shown next to a link, without a leading `www.`; empty when the href does not parse. */
export function sourceDomain(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
