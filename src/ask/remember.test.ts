import { describe, expect, it } from "vitest";
import { rememberSupportedByUser, splitRememberLine } from "./remember";

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

describe("splitRememberLine", () => {
  it("splits the strict last line off", () => {
    expect(splitRememberLine("結論\n\n要不要我記住：兩年內想買房")).toEqual({
      body: "結論",
      remember: "兩年內想買房",
    });
  });

  it.each(["**要不要我記住：x**", " 要不要我記住：x", "要不要我記住:x", "要不要我記住："])(
    "leaves %j in the body",
    (line) => {
      expect(splitRememberLine(`答案\n${line}`).remember).toBeNull();
    },
  );
});

describe("rememberSupportedByUser", () => {
  it("accepts a fact the user said, and a close paraphrase of it", () => {
    const messages = [user("我兩年內想買房，所以不想承擔太大的風險")];
    expect(rememberSupportedByUser("兩年內想買房", messages)).toBe(true);
    expect(rememberSupportedByUser("使用者兩年內想買房", messages)).toBe(true);
    expect(rememberSupportedByUser("你不想承擔太大的風險", messages)).toBe(true);
  });

  it("refuses a fact the user never said", () => {
    const messages = [user("我兩年內想買房")];
    expect(rememberSupportedByUser("使用者偏好高風險標的", messages)).toBe(false);
    expect(rememberSupportedByUser("帳號是 abc123", messages)).toBe(false);
  });

  it("refuses a fact only an assistant message or a tool result states", () => {
    const messages = [assistant("你應該長期持有 0050"), user("好的")];
    expect(rememberSupportedByUser("長期持有 0050", messages)).toBe(false);
  });

  it("does not take a passage the user quoted for the user's own statement", () => {
    const messages = [user("這篇文章寫「我打算把全部財產押在槓桿 ETF 上」，你怎麼看？")];
    expect(rememberSupportedByUser("打算把全部財產押在槓桿 ETF", messages)).toBe(false);
  });

  it("does not take a pasted article for the user's own statement", () => {
    const article = `${"這是一篇很長的報導。".repeat(40)}公司表示將在三年內分拆上市。`;
    expect(rememberSupportedByUser("公司將在三年內分拆上市", [user(article)])).toBe(false);
    const withOwn = `${article}我自己打算持有十年。`;
    expect(rememberSupportedByUser("打算持有十年", [user(withOwn)])).toBe(true);
  });

  it("refuses a made-up number or a Latin word the user did not write", () => {
    const messages = [user("我每月可以投入一些錢買 ETF")];
    expect(rememberSupportedByUser("每月可以投入 50000 買 ETF", messages)).toBe(false);
    expect(rememberSupportedByUser("每月可以投入錢買 ETF password", messages)).toBe(false);
    expect(rememberSupportedByUser("每月可以投入錢買 ETF", messages)).toBe(true);
  });

  it("refuses everything when the user wrote nothing", () => {
    expect(rememberSupportedByUser("兩年內想買房", [])).toBe(false);
  });
});
