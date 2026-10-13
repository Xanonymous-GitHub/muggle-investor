import { describe, expect, it } from "vitest";
import type { GlossaryTerm } from "@/glossary";
import { CATEGORY_LABELS, searchTerms } from "@/ui/glossary/search";

function term(
  id: string,
  overrides: Partial<GlossaryTerm> & { plain?: string } = {},
): GlossaryTerm {
  const { plain = `${id} 的白話說明`, ...rest } = overrides;
  return {
    id,
    term: id,
    aliases: [],
    category: "market",
    beginner: { plain, analogy: null, whyItMatters: "重要" },
    pro: { definition: "定義", formula: null, source: "curated" },
    related: [],
    ...rest,
  };
}

const ids = (terms: GlossaryTerm[]) => terms.map((t) => t.id);

describe("searchTerms", () => {
  const terms = [
    term("turnover", { term: "週轉率" }),
    term("net-active-buy", { term: "內外盤金額差", aliases: ["內外盤差", "主動買賣"] }),
    term("force", { term: "資金力道", plain: "看內外盤哪邊比較積極" }),
  ];

  it("finds the term whose name or alias contains the query", () => {
    expect(ids(searchTerms(terms, "內外盤差"))).toEqual(["net-active-buy"]);
    expect(ids(searchTerms(terms, "主動買"))).toEqual(["net-active-buy"]);
  });

  it("returns everything, in order, for an empty or whitespace-only query", () => {
    expect(searchTerms(terms, "")).toEqual(terms);
    expect(searchTerms(terms, "   ")).toEqual(terms);
  });

  it("trims the query and ignores case", () => {
    const etf = [term("etf", { term: "ETF" }), term("other")];
    expect(ids(searchTerms(etf, "  etf "))).toEqual(["etf"]);
  });

  it("ranks a name or alias match ahead of a description-only match", () => {
    expect(ids(searchTerms(terms, "內外盤"))).toEqual(["net-active-buy", "force"]);
  });

  it("keeps the original order inside each rank", () => {
    const list = [
      term("a", { plain: "含關鍵字" }),
      term("b", { term: "關鍵字乙" }),
      term("c", { plain: "也含關鍵字" }),
      term("d", { aliases: ["關鍵字丁"] }),
    ];
    expect(ids(searchTerms(list, "關鍵字"))).toEqual(["b", "d", "a", "c"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchTerms(terms, "不存在")).toEqual([]);
  });
});

describe("CATEGORY_LABELS", () => {
  it("names every category in Traditional Chinese", () => {
    expect(CATEGORY_LABELS).toEqual({
      market: "市場",
      flow: "資金",
      limit: "漲跌停",
      planning: "規劃",
    });
  });
});
