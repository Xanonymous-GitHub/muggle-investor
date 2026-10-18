import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary/terms";
import { AnswerView } from "./answer-view";

type Props = Partial<React.ComponentProps<typeof AnswerView>>;

function renderAnswer(text: string, props: Props = {}) {
  const onOpenTerm = props.onOpenTerm ?? vi.fn();
  const view = render(
    <AnswerView
      text={text}
      lens="pro"
      unsupported={[]}
      terms={GLOSSARY}
      onOpenTerm={onOpenTerm}
      {...props}
    />,
  );
  return { ...view, onOpenTerm };
}

describe("AnswerView safety", () => {
  it("shows raw HTML as text and creates no element from it", () => {
    const { container } = renderAnswer(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n<b onclick="x()">bold</b>',
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("<img src=x");
  });

  it("renders no anchor for a javascript: link and keeps its words", () => {
    const { container } = renderAnswer("[點我](javascript:alert(1))");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("點我");
    expect(container.innerHTML).not.toContain("javascript:");
  });

  it.each([
    "[x](data:text/html,<b>hi</b>)",
    "[x](//evil.com/a)",
    "[x](http://user:pw@evil.com/)",
    "[x](mailto:a@b.com)",
    "[x](/relative)",
    "[x](vbscript:y)",
    "[x][ref]\n\n[ref]: javascript:alert(1)",
    "[x](JAVASCRIPT:alert(1))",
    "[x](&#106;avascript:alert(1))",
  ])("renders no anchor for %j", (text) => {
    const { container } = renderAnswer(text);
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML.toLowerCase()).not.toContain("javascript:");
  });

  it("opens a valid link in a new tab, safely, and shows its domain", () => {
    renderAnswer("見 [公開資訊觀測站](https://www.example.com/path?q=1)。");
    const link = screen.getByRole("link", { name: /公開資訊觀測站/ });
    expect(link.getAttribute("href")).toBe("https://www.example.com/path?q=1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("example.com")).toBeTruthy();
  });

  it("links an autolink and a bare angle-bracket URL the same safe way", () => {
    renderAnswer("<https://example.org/a>");
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.org/a");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders no image: not for markdown, not for html", () => {
    const { container } = renderAnswer(
      "![圖說](https://example.com/x.png)\n\n![](https://example.com/y.png)\n\n![r][ref]\n\n[ref]: https://example.com/z.png",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("<img");
    expect(container.textContent).toContain("圖說");
  });

  it("does not turn other block syntax into elements it does not style", () => {
    const { container } = renderAnswer("# 大標\n\n> 引用\n\n---\n\n```\ncode\n```");
    expect(container.querySelector("h1,h2,h4,h5,h6,blockquote,hr,pre,table")).toBeNull();
    expect(container.textContent).toContain("大標");
    expect(container.textContent).toContain("引用");
  });
});

describe("AnswerView formatting", () => {
  it("renders paragraphs, bold, italic, lists and inline code", () => {
    const { container } = renderAnswer(
      "第一段 **粗體** 與 *斜體* 與 `code`。\n\n第二段\n\n- 甲\n- 乙\n\n1. 一\n2. 二",
    );
    expect(container.querySelectorAll("p").length).toBe(2);
    expect(container.querySelector("strong")?.textContent).toBe("粗體");
    expect(container.querySelector("em")?.textContent).toBe("斜體");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(screen.getAllByRole("listitem").length).toBe(4);
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
  });

  it("turns the pinned heading lines into headings, even with the content on the next line", () => {
    renderAnswer("**結論**\n先觀望。\n**依據**\n- 資料一\n\n**信心程度**\n中，因為資料不完整。");
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => h.textContent)).toEqual(["結論", "依據", "信心程度"]);
    expect(headings.every((h) => h.tagName === "H3")).toBe(true);
    expect(screen.getByText(/先觀望/).tagName).toBe("P");
  });

  it("leaves bold that is not a whole heading line as ordinary bold", () => {
    const { container } = renderAnswer("**結論**：先觀望\n\n這是 **依據** 嗎\n\n**其他標題**");
    expect(screen.queryAllByRole("heading")).toEqual([]);
    expect(container.querySelectorAll("strong").length).toBe(3);
  });

  it("does not let a model-written markdown heading look like a pinned heading", () => {
    renderAnswer("### 結論\n\n內文");
    expect(screen.queryAllByRole("heading")).toEqual([]);
  });

  it("keeps single line breaks inside a paragraph visible", () => {
    renderAnswer("第一行\n第二行");
    const p = screen.getByText(/第一行/);
    expect(p.className).toContain("whitespace-pre-line");
  });

  it("renders nothing harmful for an empty answer", () => {
    const { container } = renderAnswer("");
    expect(container.querySelector("a,img,script")).toBeNull();
  });
});

describe("AnswerView number marks", () => {
  it("marks an unsupported number only where it occurs", () => {
    const { container } = renderAnswer("營收 1,234 億，成長 12%，毛利率 45%。", {
      unsupported: ["12%"],
    });
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("12%");
    expect(marks[0]?.getAttribute("title")).toBe("沒有對應到資料來源");
    expect(marks[0]?.className).toContain("decoration-dotted");
  });

  it("marks every occurrence of the same string", () => {
    const { container } = renderAnswer("成長 12%，之後仍是 12%。", { unsupported: ["12%"] });
    expect(container.querySelectorAll("mark").length).toBe(2);
  });

  it("does not mark inside a longer number", () => {
    const { container } = renderAnswer("2012 年與 12.5% 與 112", { unsupported: ["12"] });
    expect(container.querySelectorAll("mark").length).toBe(0);
  });

  it("marks inside bold and lists but not inside code", () => {
    const { container } = renderAnswer("**漲 9%**\n\n- 跌 7%\n\n`3.5%`", {
      unsupported: ["9%", "7%", "3.5%"],
    });
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["9%", "7%"]);
  });

  it("marks nothing when the string is not in the text", () => {
    const { container } = renderAnswer("沒有數字", { unsupported: ["99%"] });
    expect(container.querySelectorAll("mark").length).toBe(0);
  });

  it("marks nothing in a heading", () => {
    const { container } = renderAnswer("**結論**\n\n好", { unsupported: ["結論"] });
    expect(container.querySelectorAll("mark").length).toBe(0);
  });
});

describe("AnswerView term chips", () => {
  const etf = GLOSSARY.find((t) => t.id === "etf");
  const dca = GLOSSARY.find((t) => t.id === "dca");
  if (etf === undefined || dca === undefined) throw new Error("glossary fixture changed");

  it("shows one chip for a glossary term in the beginner lens, the first time only", () => {
    renderAnswer("ETF 很分散，ETF 也有費用。", { lens: "beginner" });
    expect(screen.getAllByRole("button", { name: etf.term }).length).toBe(1);
    // The sentence is still readable around the chip.
    expect(screen.getByText(/很分散/)).toBeTruthy();
  });

  it("adds no chip in the pro lens", () => {
    renderAnswer("ETF 很分散，定期定額也行。", { lens: "pro" });
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("opens the term through onOpenTerm", async () => {
    const { onOpenTerm } = renderAnswer("可以用 ETF 定期定額。", { lens: "beginner" });
    await userEvent.click(screen.getByRole("button", { name: etf.term }));
    expect(onOpenTerm).toHaveBeenCalledWith("etf");
    await userEvent.click(screen.getByRole("button", { name: dca.term }));
    expect(onOpenTerm).toHaveBeenCalledWith("dca");
  });

  it("matches an alias and keeps the words the answer used", () => {
    renderAnswer("看 指數股票型基金 的費用", { lens: "beginner" });
    const chip = screen.getByRole("button", { name: "指數股票型基金" });
    expect(chip).toBeTruthy();
  });

  it("never puts a chip inside a link, code, or a heading", () => {
    const { container } = renderAnswer(
      "[ETF 介紹](https://example.com/etf)\n\n`ETF`\n\n**結論**\n\n文字",
      { lens: "beginner" },
    );
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(container.querySelector("a")?.textContent).toContain("ETF 介紹");
  });

  it("does not use up a term on a skipped place: a later plain mention still gets the chip", () => {
    renderAnswer("[ETF](https://example.com) 與 ETF", { lens: "beginner" });
    const chips = screen.getAllByRole("button", { name: etf.term });
    expect(chips.length).toBe(1);
    expect(within(screen.getByRole("link")).queryAllByRole("button")).toEqual([]);
  });

  it("a number mark wins over a chip on the same text", () => {
    const { container } = renderAnswer("ETF", { lens: "beginner", unsupported: ["ETF"] });
    expect(container.querySelectorAll("mark").length).toBe(1);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("ignores an unknown term id from the term list", () => {
    renderAnswer("火星債券 很特別", {
      lens: "beginner",
      terms: [{ id: "not-in-glossary", term: "火星債券" }],
    });
    // The chip renders nothing for an id the bundled vocabulary lacks; the words stay.
    expect(screen.getByText(/很特別/)).toBeTruthy();
  });
});
