import { type HTMLElement, type Node, parse } from "node-html-parser";

export type ReportTable = { headers: string[]; rows: string[][] };
export type ReportSection = {
  heading: string;
  level: 2 | 3;
  items: string[];
  paragraphs: string[];
  tables: ReportTable[];
};
export type ReportDocument = {
  title: string;
  intro: string[];
  introTables: ReportTable[];
  sections: ReportSection[];
  text: string;
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function parseTable(table: HTMLElement): ReportTable {
  const headers: string[] = [];
  const rows: string[][] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const ths = tr.querySelectorAll("th");
    const tds = tr.querySelectorAll("td");
    if (tds.length === 0 && ths.length > 0) {
      if (headers.length === 0) headers.push(...ths.map((c) => clean(c.text)));
    } else {
      rows.push(tds.map((c) => clean(c.text)));
    }
  }
  return { headers, rows };
}

const BLOCK_TAGS = new Set(["h1", "h2", "h3", "p", "li", "ul", "ol", "div", "br"]);

function renderText(node: Node): string {
  if (!("tagName" in node) || !node.tagName) {
    return node.text;
  }
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "tr") {
    const cells = el.childNodes
      .filter((c) => "tagName" in c && c.tagName)
      .map((c) => clean(c.text));
    return `\n${cells.join(" | ")}\n`;
  }
  const inner = el.childNodes.map(renderText).join("");
  return BLOCK_TAGS.has(tag) ? `\n${inner}\n` : inner;
}

function splitParagraph(p: HTMLElement): string[] {
  return p.innerHTML
    .split(/<br\s*\/?>/i)
    .map((part) => clean(parse(part).text))
    .filter((part) => part.length > 0);
}

export function parseReportDocument(html: string): ReportDocument {
  const root = parse(html);
  for (const el of root.querySelectorAll("script, style, noscript")) el.remove();
  const main = root.querySelector("main") ?? root.querySelector("body") ?? root;
  const title = clean(root.querySelector("h1")?.text ?? root.querySelector("title")?.text ?? "");

  const intro: string[] = [];
  const introTables: ReportTable[] = [];
  const sections: ReportSection[] = [];
  let current: ReportSection | undefined;

  const visit = (el: HTMLElement) => {
    switch ((el.tagName ?? "").toLowerCase()) {
      case "h2":
      case "h3":
        current = {
          heading: clean(el.text),
          level: el.tagName.toLowerCase() === "h2" ? 2 : 3,
          items: [],
          paragraphs: [],
          tables: [],
        };
        sections.push(current);
        return;
      case "p":
        if (current) current.paragraphs.push(clean(el.text));
        else intro.push(...splitParagraph(el));
        return;
      case "ul":
      case "ol": {
        const items = el.querySelectorAll("li").map((li) => clean(li.text));
        if (current) current.items.push(...items);
        return;
      }
      case "table":
        (current ? current.tables : introTables).push(parseTable(el));
        return;
      default:
        for (const child of el.childNodes) {
          if ("tagName" in child && child.tagName) visit(child as HTMLElement);
        }
    }
  };
  visit(main);

  const text = renderText(main);

  return {
    title,
    intro,
    introTables,
    sections,
    text: text
      .split("\n")
      .map(clean)
      .filter((l) => l.length > 0)
      .join("\n"),
  };
}

export function findSection(doc: ReportDocument, headingPrefix: string): ReportSection | undefined {
  return doc.sections.find((s) => s.heading.startsWith(headingPrefix));
}
