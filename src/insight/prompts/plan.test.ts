import { describe, expect, it } from "vitest";
import { LEVEL3_REFERENCE } from "../../../test/helpers/plan-fixtures";
import { buildPlanFacts } from "../facts-plan";
import { ADVICE_WORDS } from "../forbidden-wording";
import { checkGrounding, findAdviceWording, findForbiddenPredictions } from "../grounding";
import { LENSES } from "../lens";
import { buildPlanPrompts, PLAN_BEGINNER_SECTION_TITLE, PLAN_PROMPT_VERSION } from "./plan";
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
      for (const word of [...PROMPT_BANNED_WORDS, ...ADVICE_WORDS]) {
        expect(system).toContain(`「${word}」`);
      }
    }
  });

  it("uses no banned, forecast or advice word outside the quoted lists", () => {
    for (const lens of LENSES) {
      const rest = prompts(lens).system.replace(BANNED_WORDS, "").replace(NO_ADVICE_RULE, "");
      for (const word of [...PROMPT_BANNED_WORDS, ...ADVICE_WORDS]) {
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
