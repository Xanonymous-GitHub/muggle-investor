import { describe, expect, it } from "vitest";
import { LEVEL_NAMES } from "@/planner/rules/levels";
import { LEVEL3_BOND_AS_CASH, LEVEL3_REFERENCE } from "../../../test/helpers/plan-fixtures";
import { buildPlanFacts } from "../facts-plan";
import { ADVICE_WORDS } from "../forbidden-wording";
import { checkGrounding, findAdviceWording, findForbiddenPredictions } from "../grounding";
import { LENSES } from "../lens";
import {
  buildPlanPrompts,
  PLAN_BEGINNER_SECTION_TITLE,
  PLAN_EXTRA_ADVICE_RULE,
  PLAN_EXTRA_ADVICE_WORDS,
  PLAN_PROMPT_VERSION,
} from "./plan";
import {
  BANNED_WORDS,
  EDUCATION_DISCLAIMER,
  NO_ADVICE_RULE,
  PLAN_PROMPT_TERMS,
  PROMPT_BANNED_WORDS,
} from "./shared";

const facts = buildPlanFacts({ ...LEVEL3_REFERENCE, equityOnly: null });

const prompts = (lens: (typeof LENSES)[number]) => buildPlanPrompts(lens, 3, facts);

describe("buildPlanPrompts", () => {
  it("starts at prompt version 1", () => {
    expect(PLAN_PROMPT_VERSION).toBe(1);
  });

  it("uses the fact sheet text as the prompt and names the level", () => {
    for (const lens of LENSES) {
      expect(prompts(lens).prompt).toBe(facts.text);
      expect(prompts(lens).system).toContain("風險等級 3");
    }
  });

  it("lists every banned word and advice word from the registry", () => {
    for (const lens of LENSES) {
      const { system } = prompts(lens);
      for (const word of [...PROMPT_BANNED_WORDS, ...ADVICE_WORDS, ...PLAN_EXTRA_ADVICE_WORDS]) {
        expect(system).toContain(`「${word}」`);
      }
    }
  });

  it("uses no banned, forecast or advice word outside the quoted lists", () => {
    for (const lens of LENSES) {
      const { system } = prompts(lens);
      for (const quoted of [BANNED_WORDS, NO_ADVICE_RULE, PLAN_EXTRA_ADVICE_RULE]) {
        expect(system.split(quoted)).toHaveLength(2);
      }
      const rest = system
        .replace(BANNED_WORDS, "")
        .replace(NO_ADVICE_RULE, "")
        .replace(PLAN_EXTRA_ADVICE_RULE, "");
      for (const word of [...PROMPT_BANNED_WORDS, ...ADVICE_WORDS, ...PLAN_EXTRA_ADVICE_WORDS]) {
        expect(rest, `${lens}: ${word}`).not.toContain(word);
      }
      expect(findForbiddenPredictions(rest)).toEqual([]);
      expect(findAdviceWording(rest)).toEqual([]);
    }
  });

  it("offers exactly the plan glossary ids", () => {
    for (const lens of LENSES) {
      const { system } = prompts(lens);
      for (const term of PLAN_PROMPT_TERMS) expect(system).toContain(`- ${term.id}：${term.term}`);
      expect(system).not.toContain("- force：");
    }
  });

  it("gives the beginner lens its plain-language section title and the pro lens none", () => {
    expect(prompts("beginner").system).toContain(`「${PLAN_BEGINNER_SECTION_TITLE}」`);
    expect(prompts("pro").system).not.toContain(PLAN_BEGINNER_SECTION_TITLE);
    expect(findForbiddenPredictions(PLAN_BEGINNER_SECTION_TITLE)).toEqual([]);
    expect(checkGrounding(PLAN_BEGINNER_SECTION_TITLE, facts).ok).toBe(true);
  });

  it("asks for the disclaimer, past tense, the cash fallback and no 0% slices", () => {
    for (const lens of LENSES) {
      const { system } = prompts(lens);
      expect(system).toContain(`「${EDUCATION_DISCLAIMER}」`);
      expect(system).toContain("過去式");
      expect(system).toContain("一次性的歷史試算");
      expect(system).toContain("以現金計算");
      expect(system).toContain("沒有列出的部位");
      expect(system).toContain("金額");
      expect(system).not.toContain("過去表現不代表");
    }
  });

  it("lists the plan's extra advice words as the R-E5 set with the R-E11 additions, without 定存", () => {
    expect(PLAN_EXTRA_ADVICE_WORDS).toEqual([
      "適合",
      "合適",
      "安心",
      "放心",
      "建議配置",
      "可以考慮",
      "不用擔心",
      "勝過",
      "優於",
      "保本",
      "零風險",
      "安全",
      "穩定",
      "低風險",
      "風險低",
      "風險較低",
      "抗跌",
      "避險",
    ]);
  });

  it("uses no extra advice word in the level names, fact sheets, warnings, disclaimer or section title", () => {
    const fixed = [
      ...Object.values(LEVEL_NAMES),
      buildPlanFacts(LEVEL3_REFERENCE).text,
      buildPlanFacts(LEVEL3_BOND_AS_CASH).text,
      EDUCATION_DISCLAIMER,
      PLAN_BEGINNER_SECTION_TITLE,
    ];
    expect(buildPlanFacts(LEVEL3_BOND_AS_CASH).text).toContain("以現金計算");
    for (const text of fixed) {
      for (const word of PLAN_EXTRA_ADVICE_WORDS) expect(text, word).not.toContain(word);
    }
  });

  it("forbids suitability, reassurance, product comparisons and reading 年化報酬率 as every year", () => {
    for (const lens of LENSES) {
      const { system } = prompts(lens);
      expect(system).toContain("不要評論這個配置對哪一種人比較好");
      expect(system).toContain("不要安撫讀者");
      expect(system).toContain("也不要評論哪個等級的風險高低");
      expect(system).toContain("也不要和其他商品比較");
      expect(system).toContain("平均每年");
      expect(system).toContain("不要寫成每年都");
    }
  });

  it("states no general claim about how an asset class moves", () => {
    for (const lens of LENSES) {
      const { system } = prompts(lens);
      expect(system).not.toContain("不同步");
      expect(system).not.toContain("起伏小一些");
      expect(system).toContain("不要加入 FACTS 以外的一般說法");
    }
  });

  it("has the pro lens set figures side by side without differences", () => {
    const { system } = prompts("pro");
    expect(system).toContain("並列");
    expect(system).toContain("不要寫出差值");
  });

  it("leaves no template residue", () => {
    for (const lens of LENSES) {
      const { system } = prompts(lens);
      for (const residue of ["{{", "}}", "${", "undefined", "null", "NaN", "[object"]) {
        expect(system).not.toContain(residue);
      }
    }
  });
});
