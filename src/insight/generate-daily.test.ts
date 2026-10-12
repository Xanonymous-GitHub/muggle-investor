import { readFileSync } from "node:fs";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { getBriefing } from "@/db/repositories/briefings";
import { parseDigest, parseSectorBoard } from "@/sources/darkfanxing";
import { createTestDb } from "../../test/helpers/test-db";
import type { BriefingContent } from "./briefing-content";
import { buildDailyFacts } from "./facts";
import { generateDailyBriefing } from "./generate-daily";
import { checkGrounding, findForbiddenPredictions } from "./grounding";
import { LENSES } from "./lens";
import type { GenerateObjectRequest, Llm } from "./llm";
import {
  buildDailyPrompts,
  DAILY_PROMPT_TERMS,
  DAILY_PROMPT_VERSION,
  EDUCATION_DISCLAIMER,
} from "./prompts/daily";

const fixture = (name: string) => readFileSync(`test/fixtures/darkfanxing/${name}`, "utf8");
const digest = parseDigest(fixture("digest-2026-10-08.html"));
const board = parseSectorBoard(fixture("now-2026-10-08.html"));

const content: BriefingContent = {
  headline: "台指期收 49349 點",
  summary: "上漲族群 87、下跌族群 88，漲跌幾乎各半。",
  sections: [
    { title: "大盤節奏", body: "力度 -0.63%、面積 +0.2%。" },
    { title: "這對你意味著什麼", body: "像班上一半同學考好、一半考差，平均分數看不出全貌。" },
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

describe("generateDailyBriefing", () => {
  let db: Db;
  const logger = pino({ level: "silent" });

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(LENSES)("stores the %s daily briefing under the digest's trade date", async (lens) => {
    const { llm, requests } = fakeLlm();

    const result = await generateDailyBriefing({ db, llm, logger }, { digest, board, lens });

    expect(result).toEqual({ status: "saved" });
    expect(requests).toHaveLength(1);
    const briefing = await getBriefing(db, "daily", "2026-10-08", lens);
    expect(briefing).toMatchObject({
      kind: "daily",
      periodKey: "2026-10-08",
      lens,
      promptVersion: DAILY_PROMPT_VERSION,
    });
  });

  it.each(LENSES)("sends the %s lens rules, the caveats and the fact sheet", async (lens) => {
    const { llm, requests } = fakeLlm();

    await generateDailyBriefing({ db, llm, logger }, { digest, board, lens });

    const [request] = requests;
    if (!request) throw new Error("the LLM was not called");
    for (const caveat of digest.caveats) expect(request.system).toContain(caveat);
    expect(request.system).toContain(EDUCATION_DISCLAIMER);
    expect(request.prompt).toBe(buildDailyFacts(digest, board).text);
    if (lens === "beginner") expect(request.system).toContain("這對你意味著什麼");
    else expect(request.system).not.toContain("這對你意味著什麼");
  });

  it("ignores a board from another trade date and logs a warning instead of throwing", async () => {
    const { llm, requests } = fakeLlm();
    const warn = vi.spyOn(logger, "warn");
    const staleBoard = { ...board, tradeDate: "2026-10-07" };

    const result = await generateDailyBriefing(
      { db, llm, logger },
      { digest, board: staleBoard, lens: "pro" },
    );

    expect(result).toEqual({ status: "saved" });
    expect(requests[0]?.prompt).toBe(buildDailyFacts(digest, null).text);
    expect(requests[0]?.prompt).not.toContain("成交金額");
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("buildDailyPrompts", () => {
  const facts = buildDailyFacts(digest, board);

  it("asks for a disclaimer that passes both validators unchanged", () => {
    expect(findForbiddenPredictions(EDUCATION_DISCLAIMER)).toEqual([]);
    expect(checkGrounding(EDUCATION_DISCLAIMER, facts)).toEqual({ ok: true, ungrounded: [] });
    for (const lens of LENSES) {
      expect(buildDailyPrompts(lens, facts, digest.caveats).system).toContain(
        `「${EDUCATION_DISCLAIMER}」`,
      );
    }
  });

  it("lists only market, flow and limit glossary terms, without ETF", () => {
    const { system } = buildDailyPrompts("beginner", facts, digest.caveats);
    expect(system).toContain("- force：力度");
    expect(system).toContain("- net-active-buy：內外盤金額差");
    expect(system).toContain("- limit-locked：漲停鎖死");
    for (const id of ["dca", "lump-sum", "cagr", "max-drawdown", "volatility", "etf"]) {
      expect(system).not.toContain(`- ${id}：`);
    }
    expect(DAILY_PROMPT_TERMS.map((term) => term.category)).not.toContain("planning");
  });

  it("frames the verbatim caveats as background the model must not copy", () => {
    // The source's own caveat trips the prediction check, so the prompt must keep saying
    // not to copy it into the briefing.
    expect(findForbiddenPredictions(digest.caveats.join("\n"))).not.toEqual([]);
    const { system } = buildDailyPrompts("pro", facts, digest.caveats);
    expect(system).toContain("不要抄進簡報");
    for (const caveat of digest.caveats) expect(system).toContain(caveat);
  });

  it("bans every future-time word the prediction check looks for", () => {
    const { system } = buildDailyPrompts("beginner", facts, digest.caveats);
    for (const word of ["明天", "明日", "隔天", "下週", "下周", "下個交易日", "未來"]) {
      expect(system).toContain(`「${word}」`);
    }
  });

  it("asks the pro lens for side-by-side figures, never differences", () => {
    const { system } = buildDailyPrompts("pro", facts, digest.caveats);
    expect(system).toContain("並列");
    expect(system).toContain("不要寫出差值");
  });

  it("uses the fact sheet text as the prompt", () => {
    expect(buildDailyPrompts("pro", facts, digest.caveats).prompt).toBe(facts.text);
  });
});
