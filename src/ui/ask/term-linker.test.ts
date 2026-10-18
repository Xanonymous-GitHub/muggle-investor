import { describe, expect, it } from "vitest";
import { findTermMatches } from "./term-linker";

const TERMS = [
  { id: "etf", term: "ETF", aliases: ["指數股票型基金"] },
  { id: "dividend", term: "股利" },
  { id: "dividend-yield", term: "殖利率", aliases: ["股利殖利率"] },
  { id: "pe", term: "本益比", aliases: [] },
  { id: "a", term: "A" },
];

const slice = (text: string, m: { start: number; end: number }) => text.slice(m.start, m.end);

describe("findTermMatches", () => {
  it("finds a term by name", () => {
    const text = "本益比越低不代表越便宜";
    const found = findTermMatches(text, TERMS);
    expect(found).toEqual([{ start: 0, end: 3, id: "pe" }]);
  });

  it("matches an alias to the term's id", () => {
    const text = "指數股票型基金很分散";
    const found = findTermMatches(text, TERMS);
    expect(found.map((m) => [m.id, slice(text, m)])).toEqual([["etf", "指數股票型基金"]]);
  });

  it("prefers the longest match over a shorter one that starts or sits inside it", () => {
    const text = "股利殖利率是什麼";
    const found = findTermMatches(text, TERMS);
    expect(found.map((m) => [m.id, slice(text, m)])).toEqual([["dividend-yield", "股利殖利率"]]);
  });

  it("keeps non-overlapping matches, in text order", () => {
    const text = "殖利率和本益比，還有股利";
    const found = findTermMatches(text, TERMS);
    expect(found.map((m) => m.id)).toEqual(["dividend-yield", "pe", "dividend"]);
    expect(found.map((m) => m.start)).toEqual([...found.map((m) => m.start)].sort((a, b) => a - b));
  });

  it("only links the first occurrence of a term", () => {
    const text = "ETF 很方便，ETF 也有費用";
    expect(findTermMatches(text, TERMS)).toEqual([{ start: 0, end: 3, id: "etf" }]);
  });

  it("counts a later alias hit of an already-linked id as the same term", () => {
    const text = "ETF 又叫指數股票型基金";
    expect(findTermMatches(text, TERMS)).toEqual([{ start: 0, end: 3, id: "etf" }]);
  });

  it("ignores names shorter than two characters", () => {
    expect(findTermMatches("A 和 B", TERMS)).toEqual([]);
  });

  it("does not overlap a longer match that was taken first", () => {
    const terms = [
      { id: "x", term: "市場價格" },
      { id: "y", term: "價格波動" },
    ];
    const text = "市場價格波動";
    const found = findTermMatches(text, terms);
    // Both are 4 long; the earlier one wins and the overlapping one is dropped.
    expect(found).toEqual([{ start: 0, end: 4, id: "x" }]);
  });

  it("matches the exact casing only", () => {
    expect(findTermMatches("etf 與 ETF", TERMS)).toEqual([{ start: 6, end: 9, id: "etf" }]);
  });

  it("returns nothing for empty text or no terms", () => {
    expect(findTermMatches("", TERMS)).toEqual([]);
    expect(findTermMatches("ETF", [])).toEqual([]);
  });

  it("treats regex characters in a name literally", () => {
    const terms = [{ id: "p", term: "(a+)+", aliases: [] }];
    expect(findTermMatches("x (a+)+ y", terms)).toEqual([{ start: 2, end: 7, id: "p" }]);
  });
});
