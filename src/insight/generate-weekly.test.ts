import { readFileSync } from "node:fs";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { getBriefing } from "@/db/repositories/briefings";
import { parseDigest } from "@/sources/darkfanxing";
import { createTestDb } from "../../test/helpers/test-db";
import type { BriefingContent } from "./briefing-content";
import { buildWeeklyFacts, type WeeklyDay } from "./facts-weekly";
import { generateWeeklyBriefing } from "./generate-weekly";
import { checkGrounding, findForbiddenPredictions } from "./grounding";
import { LENSES } from "./lens";
import type { GenerateObjectRequest, Llm } from "./llm";
import { EDUCATION_DISCLAIMER } from "./prompts/shared";
import {
  buildWeeklyPrompts,
  WEEKLY_BEGINNER_SECTION_TITLE,
  WEEKLY_PROMPT_VERSION,
} from "./prompts/weekly";

const digest = parseDigest(
  readFileSync("test/fixtures/darkfanxing/digest-2026-10-08.html", "utf8"),
);
const futures = digest.market.futures;
if (!futures) throw new Error("fixture has no futures");

// Monday closes at 49349 (-619); Thursday is the fixture day moved to 50200 (+851).
const days: WeeklyDay[] = [
  {
    digest: { ...digest, tradeDate: "2026-10-05" },
    dailySummary: "上漲族群 87、下跌族群 88，漲跌幾乎各半。",
  },
  {
    digest: {
      ...digest,
      market: { ...digest.market, futures: { ...futures, close: 50200, change: 851 } },
    },
    dailySummary: null,
  },
];
const facts = buildWeeklyFacts("2026-W41", days);

const content: BriefingContent = {
  headline: "本週台指期漲跌 +0.46%",
  summary: "本週台指期近月收 50200，上漲族群與下跌族群幾乎各半。",
  sections: [
    {
      title: "一週節奏",
      body: "2026-10-05 力度 -0.63%、面積 +0.2%；被動元件上榜累計 +114.88 億（上榜 2 天）。",
    },
    { title: WEEKLY_BEGINNER_SECTION_TITLE, body: "像一週的小考有好有壞，要看整週成績。" },
  ],
  takeaway: EDUCATION_DISCLAIMER,
  termIds: ["force", "area"],
};

/** A fake LLM that returns `content` for every call and remembers each request. */
function fakeLlm() {
  const requests: GenerateObjectRequest<unknown>[] = [];
  const llm: Llm = {
    modelId: "fake-model",
    async generateObject<T>(req: GenerateObjectRequest<T>) {
      requests.push(req);
      return { object: req.schema.parse(content), usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  return { llm, requests };
}

describe("generateWeeklyBriefing", () => {
  let db: Db;
  const logger = pino({ level: "silent" });

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("uses fake content that the validators accept", () => {
    const text = [content.headline, content.summary, ...content.sections.map((s) => s.body)];
    expect(checkGrounding(text.join("\n"), facts)).toEqual({ ok: true, ungrounded: [] });
    expect(findForbiddenPredictions(text.join("\n"))).toEqual([]);
  });

  it.each(LENSES)("stores the %s weekly briefing under the week key", async (lens) => {
    const { llm, requests } = fakeLlm();

    const result = await generateWeeklyBriefing(
      { db, llm, logger },
      { weekKey: "2026-W41", days, lens },
    );

    expect(result).toEqual({ status: "saved" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.prompt).toBe(facts.text);
    const briefing = await getBriefing(db, "weekly", "2026-W41", lens);
    expect(briefing).toMatchObject({
      kind: "weekly",
      periodKey: "2026-W41",
      lens,
      promptVersion: WEEKLY_PROMPT_VERSION,
    });
    expect(await getBriefing(db, "daily", "2026-10-08", lens)).toBeNull();
  });
});

describe("buildWeeklyPrompts", () => {
  it("asks for a disclaimer and a beginner section title that pass both validators", () => {
    for (const phrase of [EDUCATION_DISCLAIMER, WEEKLY_BEGINNER_SECTION_TITLE]) {
      expect(findForbiddenPredictions(phrase)).toEqual([]);
      expect(checkGrounding(phrase, facts)).toEqual({ ok: true, ungrounded: [] });
    }
    for (const lens of LENSES) {
      expect(buildWeeklyPrompts(lens, facts).system).toContain(`「${EDUCATION_DISCLAIMER}」`);
    }
  });

  it("gives the beginner lens its own section title", () => {
    expect(buildWeeklyPrompts("beginner", facts).system).toContain(
      `「${WEEKLY_BEGINNER_SECTION_TITLE}」`,
    );
    expect(buildWeeklyPrompts("pro", facts).system).not.toContain(WEEKLY_BEGINNER_SECTION_TITLE);
  });

  it("bans every future-time word the prediction check looks for", () => {
    for (const lens of LENSES) {
      const { system } = buildWeeklyPrompts(lens, facts);
      for (const word of ["明天", "明日", "隔天", "下週", "下周", "下個交易日", "未來"]) {
        expect(system).toContain(`「${word}」`);
      }
    }
  });

  it("forbids recomputing figures and explains the pre-computed week change and 上榜累計", () => {
    const { system } = buildWeeklyPrompts("pro", facts);
    expect(system).toContain("不要自己算出新的數字");
    expect(system).toContain("「本週台指期近月」");
    expect(system).toContain("「上榜累計」");
    expect(system).toContain("並列");
    expect(system).toContain("不要寫出差值");
  });

  it("offers the same glossary terms as the daily prompts", () => {
    const { system } = buildWeeklyPrompts("beginner", facts);
    expect(system).toContain("- force：力度");
    expect(system).not.toContain("- etf：");
    expect(system).not.toContain("- dca：");
  });

  it("uses the fact sheet text as the prompt", () => {
    expect(buildWeeklyPrompts("beginner", facts).prompt).toBe(facts.text);
  });
});
