import { describe, expect, it } from "vitest";
import {
  HEADINGS,
  isHeadingLine,
  safeHref,
  sourceDomain,
  splitRememberLine,
  toolLabel,
} from "./answer";

const PREFIX = "要不要我記住：";

describe("splitRememberLine", () => {
  it("takes a valid last line and removes it from the body", () => {
    const text = `**結論**\n好。\n\n${PREFIX}我偏好長期投資`;
    expect(splitRememberLine(text)).toEqual({ body: "**結論**\n好。", remember: "我偏好長期投資" });
  });

  it("ignores trailing whitespace and blank lines after the line", () => {
    expect(splitRememberLine(`答案\n${PREFIX}每月投入一萬  \n\n  \n`)).toEqual({
      body: "答案",
      remember: "每月投入一萬",
    });
  });

  it("leaves the line in the body when it is not the last non-empty line", () => {
    const text = `${PREFIX}我偏好長期投資\n之後還有一句`;
    expect(splitRememberLine(text)).toEqual({ body: text, remember: null });
  });

  it("only the last of two candidate lines counts", () => {
    const text = `${PREFIX}第一件\n${PREFIX}第二件`;
    expect(splitRememberLine(text)).toEqual({ body: `${PREFIX}第一件`, remember: "第二件" });
  });

  it.each([
    ["bold", `**${PREFIX}**我偏好長期`],
    ["bold around everything", `**${PREFIX}我偏好長期**`],
    ["list marker", `- ${PREFIX}我偏好長期`],
    ["numbered list", `1. ${PREFIX}我偏好長期`],
    ["quote", `> ${PREFIX}我偏好長期`],
    ["corner brackets", `「${PREFIX}我偏好長期」`],
    ["leading space", ` ${PREFIX}我偏好長期`],
    ["half-width colon", "要不要我記住:我偏好長期"],
    ["no colon", "要不要我記住我偏好長期"],
  ])("does not treat the %s variant as a remember line", (_name, line) => {
    const text = `答案\n${line}`;
    expect(splitRememberLine(text)).toEqual({ body: text, remember: null });
  });

  it("rejects an empty fact", () => {
    const text = `答案\n${PREFIX}`;
    expect(splitRememberLine(text)).toEqual({ body: text, remember: null });
    const spaces = `答案\n${PREFIX}   `;
    expect(splitRememberLine(spaces)).toEqual({ body: spaces, remember: null });
  });

  it("accepts 200 characters and rejects 201", () => {
    const ok = "我".repeat(200);
    expect(splitRememberLine(`${PREFIX}${ok}`).remember).toBe(ok);
    const long = `答案\n${PREFIX}${"我".repeat(201)}`;
    expect(splitRememberLine(long)).toEqual({ body: long, remember: null });
  });

  it("returns an empty body when the remember line is the whole text", () => {
    expect(splitRememberLine(`${PREFIX}我偏好長期`)).toEqual({ body: "", remember: "我偏好長期" });
  });

  it("handles CRLF line endings", () => {
    expect(splitRememberLine(`答案\r\n${PREFIX}我偏好長期\r\n`)).toEqual({
      body: "答案",
      remember: "我偏好長期",
    });
  });

  it("returns empty text unchanged", () => {
    expect(splitRememberLine("")).toEqual({ body: "", remember: null });
  });
});

describe("toolLabel", () => {
  it.each([
    ["getMarketToday", "今日行情"],
    ["getSectorBoard", "族群"],
    ["lookupTerm", "名詞"],
    ["getInstrumentHistory", "個股歷史"],
    ["getMyPlan", "你的規劃"],
    ["getLatestBriefing", "最新簡報"],
    ["loadSkill", "分析手冊"],
    ["web__search", "查網路"],
    ["mcp__brave__search", "查網路"],
    ["somethingElse", "查網路"],
    ["", "查網路"],
  ])("%s -> %s", (name, label) => {
    expect(toolLabel(name)).toBe(label);
  });
});

describe("headings", () => {
  it("lists the seven answer headings", () => {
    expect(HEADINGS).toEqual([
      "結論",
      "依據",
      "情境",
      "對你的意義",
      "建議",
      "一般選項",
      "信心程度",
    ]);
  });

  it("matches a line that is exactly a bold heading", () => {
    for (const heading of HEADINGS) expect(isHeadingLine(`**${heading}**`)).toBe(true);
  });

  it.each([
    "**結論**：好",
    "結論",
    "**結論** ",
    " **結論**",
    "**其他**",
    "## 結論",
    "**結論**\n",
    "- **結論**",
  ])("rejects %j", (line) => {
    expect(isHeadingLine(line)).toBe(false);
  });
});

describe("safeHref", () => {
  it("accepts http and https and normalizes", () => {
    expect(safeHref("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
    expect(safeHref("HTTPS://X.com/a")).toBe("https://x.com/a");
    expect(safeHref("  https://example.com/a  ")).toBe("https://example.com/a");
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:x",
    "file:///etc/passwd",
    "//evil.com/x",
    "///evil.com",
    "\\\\evil.com",
    "http://user@host.com/",
    "http://user:pw@host.com/",
    "https://@host.com/",
    "http://evil.com@host.com/",
    "mailto:a@b.com",
    "tel:123",
    "/relative/path",
    "relative/path",
    "./x",
    "#anchor",
    "?q=1",
    "http://",
    "https:///x",
    "",
  ])("rejects %j", (url) => {
    expect(safeHref(url)).toBeNull();
  });

  it("rejects a very long url", () => {
    expect(safeHref(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("sourceDomain", () => {
  it("shows the host without www", () => {
    expect(sourceDomain("https://www.example.com/a")).toBe("example.com");
    expect(sourceDomain("https://news.example.com:8080/a")).toBe("news.example.com");
  });

  it("is empty for something unparsable", () => {
    expect(sourceDomain("nope")).toBe("");
  });
});
