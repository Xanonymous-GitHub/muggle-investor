import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDigest } from "@/sources/darkfanxing";
import { findTermsInText, GLOSSARY, getTerm, glossaryTermSchema, termIds } from "./index";

const fixture = readFileSync(
  path.resolve(import.meta.dirname, "../../test/fixtures/darkfanxing/digest-2026-10-08.html"),
  "utf8",
);

const REQUIRED_IDS = [
  "sector",
  "sector-breadth",
  "force",
  "area",
  "net-active-buy",
  "concentration-ratio",
  "capital-flow-slope",
  "flow-quadrant",
  "limit-locked",
  "taiex-futures",
  "turnover",
  "change-pct",
  "one-month-change",
  "equal-weight-average",
  "quadrant-strong",
  "quadrant-weak",
  "quadrant-turning-strong",
  "quadrant-turning-weak",
  "limit-up",
  "limit-down",
  "etf",
  "dca",
  "lump-sum",
  "cagr",
  "max-drawdown",
  "volatility",
];

/** Glossary id → the term as it appears in the darkfanxing report's 詞彙表. */
const DARKFANXING_TERMS: Record<string, string> = {
  sector: "族群",
  "sector-breadth": "上漲/下跌族群數",
  force: "力度",
  area: "面積",
  "net-active-buy": "內外盤金額差",
  "concentration-ratio": "集中倍數",
  "capital-flow-slope": "近 N 日斜率",
  "flow-quadrant": "四象限",
  "limit-locked": "漲停鎖死",
};

const charCount = (text: string) => Array.from(text).length;

describe("GLOSSARY data", () => {
  it("every entry passes the schema", () => {
    for (const term of GLOSSARY) {
      expect(glossaryTermSchema.safeParse(term).success, term.id).toBe(true);
    }
  });

  it("has unique ids", () => {
    const ids = GLOSSARY.map((term) => term.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains exactly the required term ids", () => {
    expect([...termIds()].sort()).toEqual([...REQUIRED_IDS].sort());
  });

  it("only relates to existing ids, never to itself", () => {
    const ids = new Set(termIds());
    for (const term of GLOSSARY) {
      for (const related of term.related) {
        expect(ids.has(related), `${term.id} → ${related}`).toBe(true);
        expect(related, term.id).not.toBe(term.id);
      }
    }
  });

  it("matches each text pattern (term or alias) to exactly one term, and none is a single character", () => {
    const owners = new Map<string, string>();
    for (const term of GLOSSARY) {
      for (const pattern of [term.term, ...term.aliases]) {
        expect(charCount(pattern), `${term.id}: "${pattern}"`).toBeGreaterThan(1);
        const key = pattern.toLowerCase();
        expect(owners.get(key) ?? term.id, `"${pattern}"`).toBe(term.id);
        owners.set(key, term.id);
      }
    }
  });

  it("copies darkfanxing definitions verbatim from the report glossary", () => {
    const glossary = parseDigest(fixture).glossary;
    const sourced = GLOSSARY.filter((term) => term.pro.source === "darkfanxing").map((t) => t.id);
    expect([...sourced].sort()).toEqual(Object.keys(DARKFANXING_TERMS).sort());
    for (const [id, fixtureTerm] of Object.entries(DARKFANXING_TERMS)) {
      const entry = glossary.find((item) => item.term === fixtureTerm);
      expect(entry, fixtureTerm).toBeDefined();
      expect(getTerm(id)?.pro.definition, id).toBe(entry?.definition);
    }
  });

  it("gives every term a short beginner explanation and a reason to care", () => {
    for (const term of GLOSSARY) {
      expect(term.beginner.plain.trim(), term.id).not.toBe("");
      expect(charCount(term.beginner.plain), term.id).toBeLessThanOrEqual(80);
      expect(term.beginner.whyItMatters.trim(), term.id).not.toBe("");
    }
  });

  it("gives formulas for cagr, max-drawdown and volatility", () => {
    for (const id of ["cagr", "max-drawdown", "volatility"]) {
      expect(getTerm(id)?.pro.formula, id).toBeTruthy();
    }
  });
});

describe("getTerm", () => {
  it("returns the entry for a known id and undefined otherwise", () => {
    expect(getTerm("force")?.term).toBe("力度");
    expect(getTerm("no-such-term")).toBeUndefined();
  });
});

describe("findTermsInText", () => {
  it("returns ids in order of first appearance", () => {
    expect(findTermsInText("今天力度為負，內外盤金額差顯示資金流出")).toEqual([
      "force",
      "net-active-buy",
    ]);
  });

  it("lets the longest match win", () => {
    expect(findTermsInText("漲停鎖死的有 33 檔")).toEqual(["limit-locked"]);
    expect(findTermsInText("上漲族群數為 120")).toEqual(["sector-breadth"]);
  });

  it("returns [] when no term appears", () => {
    expect(findTermsInText("今天天氣很好")).toEqual([]);
    expect(findTermsInText("")).toEqual([]);
  });

  it("dedupes repeated mentions", () => {
    expect(findTermsInText("力度轉正，面積轉負，力度與面積分歧")).toEqual(["force", "area"]);
  });

  it("matches aliases", () => {
    expect(findTermsInText("內外盤差為正，漲停板有 5 檔")).toEqual(["net-active-buy", "limit-up"]);
  });

  it("ignores words that only look like terms", () => {
    expect(findTermsInText("盤中最大跌幅")).toEqual([]);
    expect(findTermsInText("單筆成交")).toEqual([]);
    expect(findTermsInText("單筆投入")).toEqual(["lump-sum"]);
  });

  it("matches ASCII terms case-insensitively but not inside longer words", () => {
    expect(findTermsInText("買 etf 或 0050ETF")).toEqual(["etf"]);
    expect(findTermsInText("NETFLIX 與 ETFs")).toEqual([]);
  });
});
