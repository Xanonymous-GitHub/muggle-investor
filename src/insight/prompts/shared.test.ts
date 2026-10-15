import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GLOSSARY } from "@/glossary";
import type { FactSheet } from "../facts";
import { ADVICE_WORDS, DIRECTION_WORDS } from "../forbidden-wording";
import { buildDailyPrompts } from "./daily";
import { glossaryList, PLAN_PROMPT_TERMS, PROMPT_BANNED_WORDS, PROMPT_TERMS } from "./shared";
import { buildWeeklyPrompts } from "./weekly";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
// The system prompts do not read the fact sheet.
const facts = { text: "", figures: [] } as unknown as FactSheet;

const PLANNING_IDS = [
  "emergency-fund",
  "rebalance",
  "bond-etf",
  "dividend-etf",
  "total-return",
  "xirr",
];

describe("briefing prompts stay byte-identical", () => {
  // Captured before the planning terms were added: a changed glossary list or system prompt
  // would also need a DAILY_/WEEKLY_PROMPT_VERSION bump.
  it("glossaryList() keeps the market/flow/limit list", () => {
    expect(glossaryList()).toBe(
      [
        "- sector：族群",
        "- sector-breadth：上漲／下跌族群數",
        "- force：力度",
        "- area：面積",
        "- net-active-buy：內外盤金額差",
        "- concentration-ratio：集中倍數",
        "- capital-flow-slope：近 N 日斜率",
        "- flow-quadrant：四象限",
        "- limit-locked：漲停鎖死",
        "- taiex-futures：台指期",
        "- turnover：成交金額",
        "- change-pct：漲跌幅",
        "- one-month-change：近 1 月漲幅",
        "- equal-weight-average：等權平均",
        "- quadrant-strong：強勢",
        "- quadrant-weak：弱勢",
        "- quadrant-turning-strong：轉強",
        "- quadrant-turning-weak：轉弱",
        "- limit-up：漲停",
        "- limit-down：跌停",
      ].join("\n"),
    );
  });

  it("daily and weekly system prompts are unchanged", () => {
    expect(sha256(buildDailyPrompts("beginner", facts, []).system)).toBe(
      "f652c19ce01111fe1942eea1195530609c8c75b2053bc3d4f2f8bc82494fcf83",
    );
    expect(sha256(buildDailyPrompts("pro", facts, []).system)).toBe(
      "5a52fa514090d634a6a2325ec7c12759e10e0f55806526d7e18687bb6ace72b0",
    );
    expect(sha256(buildWeeklyPrompts("beginner", facts).system)).toBe(
      "f2d8cdb9dbbaa9ec22745cb1a77104285efc10179ea676bdd887c5b42345bf10",
    );
    expect(sha256(buildWeeklyPrompts("pro", facts).system)).toBe(
      "7d9e71eac4ba14fb33e840c1ab6fda243d141c9c55f3dd4fd0d2641c9cbbf9fd",
    );
  });

  it("does not offer the planning terms to briefings", () => {
    const ids = PROMPT_TERMS.map((term) => term.id);
    for (const id of PLANNING_IDS) expect(ids).not.toContain(id);
    expect(PROMPT_TERMS.every((term) => term.category !== "planning")).toBe(true);
  });
});

describe("PLAN_PROMPT_TERMS", () => {
  it("is every planning term plus etf, and nothing else", () => {
    const expected = GLOSSARY.filter((t) => t.category === "planning" || t.id === "etf").map(
      (t) => t.id,
    );
    expect(PLAN_PROMPT_TERMS.map((t) => t.id)).toEqual(expected);
    for (const id of [...PLANNING_IDS, "etf", "dca", "cagr"]) {
      expect(PLAN_PROMPT_TERMS.map((t) => t.id)).toContain(id);
    }
    expect(PLAN_PROMPT_TERMS.map((t) => t.id)).not.toContain("force");
  });

  it("glossaryList renders the given terms as id：term lines", () => {
    const list = glossaryList(PLAN_PROMPT_TERMS);
    expect(list).toContain("- emergency-fund：緊急預備金");
    expect(list).toContain("- etf：ETF");
    expect(list.split("\n")).toHaveLength(PLAN_PROMPT_TERMS.length);
  });
});

describe("new planning terms", () => {
  it("are curated planning entries with beginner and pro text", () => {
    for (const id of PLANNING_IDS) {
      const term = GLOSSARY.find((t) => t.id === id);
      expect(term?.category, id).toBe("planning");
      expect(term?.pro.source, id).toBe("curated");
      expect(term?.beginner.plain.trim(), id).not.toBe("");
      expect(term?.pro.definition.trim(), id).not.toBe("");
    }
  });

  // The LLM quotes these terms, so their wording must pass the same forbidden-word checks.
  it("use no advice, forecast, future or guarantee wording", () => {
    const banned = [...PROMPT_BANNED_WORDS, ...ADVICE_WORDS, ...DIRECTION_WORDS, "應該", "建議"];
    for (const id of PLANNING_IDS) {
      const term = GLOSSARY.find((t) => t.id === id);
      const text = JSON.stringify([term?.beginner, term?.pro]);
      for (const word of banned) expect(text, `${id}: ${word}`).not.toContain(word);
    }
  });
});
