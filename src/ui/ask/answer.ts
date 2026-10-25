// Pure helpers for reading an Ask answer. Nothing here renders; the view and the chat screen
// import these, and the parsing rules are pinned by answer.test.ts.

export { splitRememberLine } from "@/ask/remember";

const TOOL_LABELS: Readonly<Record<string, string>> = {
  getMarketToday: "今日行情",
  getSectorBoard: "族群",
  lookupTerm: "名詞",
  getInstrumentHistory: "個股歷史",
  getMyPlan: "你的規劃",
  getLatestBriefing: "最新簡報",
  loadSkill: "分析手冊",
};
const OTHER_LABEL = "其他工具";
const EXTERNAL_LABEL = "外部查詢";
const SERVER_NAME = /^[A-Za-z0-9._-]{1,24}$/;

/**
 * The Chinese name of a built-in tool. An external (MCP) tool is `<server>__<tool>`: it shows the
 * configured server name, never the tool's own id, so the reader can tell which service answered.
 * An unknown name is 其他工具.
 */
export function toolLabel(name: string): string {
  const at = name.indexOf("__");
  if (at !== -1) {
    const server = name.slice(0, at);
    return SERVER_NAME.test(server) ? `${EXTERNAL_LABEL}（${server}）` : EXTERNAL_LABEL;
  }
  return Object.hasOwn(TOOL_LABELS, name) ? (TOOL_LABELS[name] ?? OTHER_LABEL) : OTHER_LABEL;
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
