"use client";

import { type ComponentProps, memo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { GLOSSARY } from "@/glossary/terms";
import { ASK_COPY } from "@/ui/ask/copy";
import { TermChip } from "@/ui/glossary/term-chip";
import { HEADINGS, isHeadingLine, safeHref, sourceDomain } from "./answer";
import { findTermMatches, type LinkableTerm } from "./term-linker";

type Props = {
  /** The answer without its 「要不要我記住：」 line. */
  text: string;
  lens: "beginner" | "pro";
  /** Number strings the server could not trace to a source; marked wherever they occur. */
  unsupported: readonly string[];
  /** The glossary to link in the beginner lens (the bundled vocabulary, or a subset). */
  terms: readonly LinkableTerm[];
  onOpenTerm(termId: string): void;
};

// ── The answer's mdast, reshaped before it becomes elements ────────────────────────────────
// react-markdown never parses raw HTML into elements (without rehype-raw it becomes text), so
// every `mark`, chip and `h2` below comes from this plugin, not from the model's words.

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  depth?: number;
  position?: { start: { line: number }; end: { line: number } };
};

const KNOWN_TERM_IDS = new Set(GLOSSARY.map((term) => term.id));
const HEADING_NAMES: readonly string[] = HEADINGS;
const DIGIT = /[0-9]/;

const text = (value: string): MdNode => ({ type: "text", value });

/** A digit, or a `,` or `.` between digits, directly before `at`: the match would be a number's tail. */
function continuesNumberBefore(value: string, at: number): boolean {
  const before = value[at - 1] ?? "";
  if (DIGIT.test(before)) return true;
  return (before === "," || before === ".") && DIGIT.test(value[at - 2] ?? "");
}

/** A digit, or a `,` or `.` before a digit, directly at `end`: the match would be a number's head. */
function continuesNumberAfter(value: string, end: number): boolean {
  const after = value[end] ?? "";
  if (DIGIT.test(after)) return true;
  return (after === "," || after === ".") && DIGIT.test(value[end + 1] ?? "");
}

/** Where `unsupported` strings occur in one text node: longest first, never inside a longer number. */
function findNumberMarks(value: string, unsupported: readonly string[]) {
  const found: { start: number; end: number }[] = [];
  const needles = [...new Set(unsupported)]
    .filter((needle) => needle !== "")
    .sort((a, b) => b.length - a.length);
  for (const needle of needles) {
    for (let at = value.indexOf(needle); at !== -1; at = value.indexOf(needle, at + 1)) {
      const end = at + needle.length;
      const insideNumber =
        (DIGIT.test(needle[0] ?? "") && continuesNumberBefore(value, at)) ||
        (DIGIT.test(needle.at(-1) ?? "") && continuesNumberAfter(value, end));
      if (insideNumber) continue;
      if (found.some((m) => at < m.end && m.start < end)) continue;
      found.push({ start: at, end });
    }
  }
  return found;
}

/** Splits one text node into plain text, number marks and term chips. */
function splitText(
  value: string,
  unsupported: readonly string[],
  pool: LinkableTerm[],
  linked: Set<string>,
): MdNode[] | null {
  const marks = findNumberMarks(value, unsupported);
  const chips =
    pool.length === 0
      ? []
      : findTermMatches(
          value,
          pool.filter((term) => !linked.has(term.id)),
        ).filter((c) => !marks.some((m) => c.start < m.end && m.start < c.end));
  if (marks.length === 0 && chips.length === 0) return null;
  for (const chip of chips) linked.add(chip.id);
  const pieces = [
    ...marks.map((m) => ({ ...m, node: markNode(value.slice(m.start, m.end)) })),
    ...chips.map((c) => ({
      start: c.start,
      end: c.end,
      node: chipNode(c.id, value.slice(c.start, c.end)),
    })),
  ].sort((a, b) => a.start - b.start);
  const out: MdNode[] = [];
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.start > cursor) out.push(text(value.slice(cursor, piece.start)));
    out.push(piece.node);
    cursor = piece.end;
  }
  if (cursor < value.length) out.push(text(value.slice(cursor)));
  return out;
}

const markNode = (value: string): MdNode => ({
  type: "unsupportedNumber",
  data: { hName: "mark" },
  children: [text(value)],
});

const chipNode = (termId: string, value: string): MdNode => ({
  type: "termChip",
  data: { hName: "span", hProperties: { dataTermId: termId } },
  children: [text(value)],
});

/**
 * A root paragraph that is nothing but `**<heading>**` and whose source is exactly that one line
 * (`isHeadingLine`): not `__結論__`, `### **結論**`, a trailing or leading space, or an indented line.
 */
function isPinnedHeading(node: MdNode, lines: readonly string[]): boolean {
  if (node.type !== "paragraph" || node.children?.length !== 1) return false;
  const { position } = node;
  if (!position || position.start.line !== position.end.line) return false;
  if (!isHeadingLine(lines[position.start.line - 1] ?? "")) return false;
  const strong = node.children[0];
  if (strong?.type !== "strong" || strong.children?.length !== 1) return false;
  const inner = strong.children[0];
  return inner?.type === "text" && HEADING_NAMES.includes(inner.value ?? "");
}

function remarkAnswer(options: {
  unsupported: readonly string[];
  pool: LinkableTerm[];
  /** The exact source the parser sees, to judge heading lines by their own text. */
  source: string;
}) {
  const lines = options.source.split("\n");
  return (tree: MdNode) => {
    const linked = new Set<string>();
    const walk = (node: MdNode, inLink: boolean, atRoot: boolean) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child): MdNode[] => {
        if (child.type === "text") {
          // Links keep their words as written: no chips, no number marks.
          const pool = inLink ? [] : options.pool;
          const unsupported = inLink ? [] : options.unsupported;
          return splitText(child.value ?? "", unsupported, pool, linked) ?? [child];
        }
        // A heading the model wrote itself must not look like a pinned one.
        if (child.type === "heading") child = { ...child, type: "paragraph" };
        if (atRoot && isPinnedHeading(child, lines)) {
          const name = child.children?.[0]?.children?.[0]?.value ?? "";
          return [{ type: "answerHeading", data: { hName: "h2" }, children: [text(name)] }];
        }
        walk(child, inLink || child.type === "link" || child.type === "linkReference", false);
        return [child];
      });
    };
    walk(tree, false, true);
  };
}

/** Every line terminator the Markdown parser honours (CRLF, bare CR, LF). */
const LINE_BREAK = /\r\n?|\n/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Normalizes line endings and puts each line that is exactly a heading (`isHeadingLine`, no
 * trimming) in a paragraph of its own, so the content lines below it stay separate. Fenced code
 * is left untouched.
 */
function isolateHeadings(source: string): string {
  let fence: string | null = null;
  return source
    .split(LINE_BREAK)
    .map((line) => {
      const opener = FENCE.exec(line)?.[1];
      if (fence === null) {
        if (opener !== undefined) fence = opener;
      } else if (opener !== undefined && opener[0] === fence[0] && opener.length >= fence.length) {
        fence = null;
      }
      return fence === null && isHeadingLine(line) ? `\n${line}\n` : line;
    })
    .join("\n");
}

// ── Elements ─────────────────────────────────────────────────────────────────────────────

const COMPONENTS = (onOpenTerm: (id: string) => void): Components => ({
  p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
  // The page's h1 is the screen title, so the answer's section titles are h2.
  // A section title sits closer to its own text (the 8 px block gap) than to the section before
  // it (that gap plus 16 px), so the grouping reads without rules or boxes.
  h2: ({ children }) => (
    <h2 className="mt-4 text-[0.8125rem] leading-5 font-semibold tracking-[0.05em] text-muted-foreground first:mt-0">
      {children}
    </h2>
  ),
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-6">{children}</ol>,
  li: ({ children }) => <li className="whitespace-pre-line">{children}</li>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] break-all">
      {children}
    </code>
  ),
  // Images are never loaded: the alt text, if any, stands in.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
  mark: ({ children }) => (
    <mark
      title={ASK_COPY.answer.unsupportedTitle}
      className="bg-transparent text-inherit underline decoration-dotted decoration-2 underline-offset-4"
    >
      {children}
    </mark>
  ),
  span: (props: ComponentProps<"span"> & { "data-term-id"?: string }) => {
    const termId = props["data-term-id"];
    if (termId === undefined) return <span>{props.children}</span>;
    const label = typeof props.children === "string" ? props.children : undefined;
    return <TermChip variant="inline" termId={termId} label={label} onOpen={onOpenTerm} />;
  },
});

function SafeLink({ href, children }: { href: string | undefined; children?: ReactNode }) {
  // `urlTransform` already blanked anything unsafe; checking again keeps this the one gate.
  const safe = href ? safeHref(href) : null;
  if (safe === null) return <>{children}</>;
  const domain = sourceDomain(safe);
  return (
    <>
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary underline underline-offset-2"
      >
        {children}
        <span className="sr-only">{ASK_COPY.answer.opensInNewTab}</span>
      </a>
      {domain !== "" && (
        <span className="text-[0.8125rem] text-muted-foreground">{`（${domain}）`}</span>
      )}
    </>
  );
}

const ALLOWED = [
  "p",
  "h2",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "code",
  "a",
  "img",
  "br",
  "mark",
  "span",
];

/**
 * An AI answer as restricted Markdown: paragraphs, bold, italic, lists, links, inline code, and
 * the pinned section titles as headings. Raw HTML is shown as text, never rendered; only http(s)
 * links become anchors; images are not loaded. Numbers in `unsupported` are marked, and in the
 * beginner lens the first mention of each glossary term becomes a chip (never inside a link).
 * Memoised: while one answer streams, the finished ones above it are not parsed again (their
 * props stay equal as long as `onOpenTerm` and the lists are stable).
 */
export const AnswerView = memo(function AnswerView({
  text: rawSource,
  lens,
  unsupported,
  terms,
  onOpenTerm,
}: Props) {
  const source = isolateHeadings(rawSource);
  const pool = lens === "beginner" ? terms.filter((term) => KNOWN_TERM_IDS.has(term.id)) : [];
  return (
    <div
      data-slot="answer"
      className="flex flex-col gap-2 text-base leading-7 break-words tabular-nums"
    >
      <Markdown
        allowedElements={ALLOWED}
        unwrapDisallowed
        urlTransform={(url) => safeHref(url) ?? ""}
        remarkPlugins={[[remarkAnswer, { unsupported, pool: [...pool], source }]]}
        components={COMPONENTS(onOpenTerm)}
      >
        {source}
      </Markdown>
    </div>
  );
});
