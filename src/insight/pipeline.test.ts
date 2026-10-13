import { readFileSync } from "node:fs";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { getBriefing, saveBriefing } from "@/db/repositories/briefings";
import { llmUsage } from "@/db/schema";
import { parseDigest } from "@/sources/darkfanxing";
import { createTestDb } from "../../test/helpers/test-db";
import type { BriefingContent } from "./briefing-content";
import { buildDailyFacts } from "./facts";
import type { GenerateObjectRequest, Llm } from "./llm";
import { LlmOutputError } from "./llm";
import { type ProduceRequest, produceBriefing } from "./pipeline";
import { buildDailyPrompts, DAILY_PROMPT_VERSION, EDUCATION_DISCLAIMER } from "./prompts/daily";

const DIGEST_HTML = readFileSync("test/fixtures/darkfanxing/digest-2026-10-08.html", "utf8");
const digest = parseDigest(DIGEST_HTML);
const facts = buildDailyFacts(digest, null);
const LLM_API_KEY = "sk-test-llm-key-0987654321";
const NOW = new Date("2026-10-08T06:00:00Z");

const silent = pino({ level: "silent" });

const valid: BriefingContent = {
  headline: "台指期收 49349 點，跌 1.24%",
  summary: "台指期近月下跌 619 點，上漲族群 87、下跌族群 88，漲跌幾乎各半。",
  sections: [
    { title: "大盤節奏", body: "力度 -0.63%、面積 +0.2%，多數族群小漲，但跌的族群跌得比較深。" },
    { title: "資金流向", body: "被動元件：+57.44 億，是內外盤金額差淨流入最多的族群。" },
  ],
  takeaway: `今天是族群各半、力度偏弱的一天。${EDUCATION_DISCLAIMER}`,
  termIds: ["force", "area"],
};

const withSummary = (summary: string): BriefingContent => ({ ...valid, summary });

/** Everything but `termIds`, which the pipeline extends with the terms found in the text. */
const textOf = ({ termIds: _termIds, ...text }: BriefingContent) => text;

type Step = BriefingContent | Error;

/** A fake LLM that answers each call from `steps` in order and remembers every request. */
function fakeLlm(steps: Step[]) {
  const requests: GenerateObjectRequest<unknown>[] = [];
  const llm: Llm = {
    modelId: "fake-model",
    async generateObject<T>(req: GenerateObjectRequest<T>) {
      requests.push(req);
      const step = steps[requests.length - 1];
      if (step === undefined) throw new Error("unexpected extra LLM call");
      if (step instanceof Error) throw step;
      return { object: req.schema.parse(step), usage: { inputTokens: 1200, outputTokens: 300 } };
    },
  };
  return { llm, requests };
}

const requestAt = (requests: GenerateObjectRequest<unknown>[], index: number) => {
  const request = requests[index];
  if (!request) throw new Error(`LLM call ${index} was not made`);
  return request;
};

describe("produceBriefing", () => {
  let db: Db;

  const request = (overrides: Partial<ProduceRequest> = {}): ProduceRequest => ({
    kind: "daily",
    periodKey: "2026-10-08",
    lens: "beginner",
    promptVersion: DAILY_PROMPT_VERSION,
    ...buildDailyPrompts("beginner", facts, digest.caveats),
    facts,
    ...overrides,
  });

  const produce = (llm: Llm, overrides: Partial<ProduceRequest> = {}) =>
    produceBriefing({ db, llm, logger: silent, now: () => NOW }, request(overrides));

  const stored = () => getBriefing(db, "daily", "2026-10-08", "beginner");
  const usageRows = () => db.select().from(llmUsage);

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("saves a valid briefing with the model id and records one usage row", async () => {
    const { llm, requests } = fakeLlm([valid]);

    const result = await produce(llm);

    expect(result).toEqual({ status: "saved" });
    expect(requests).toHaveLength(1);
    const briefing = await stored();
    expect(briefing && textOf(briefing.content)).toEqual(textOf(valid));
    expect(briefing?.content.termIds.slice(0, 2)).toEqual(valid.termIds);
    expect(briefing?.model).toBe("fake-model");
    expect(briefing?.promptVersion).toBe(DAILY_PROMPT_VERSION);
    expect(briefing?.createdAt).toEqual(NOW);
    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      purpose: "briefing:daily:beginner",
      model: "fake-model",
      inputTokens: 1200,
      outputTokens: 300,
      createdAt: NOW,
    });
  });

  it("repairs an output with a number that is not in the facts", async () => {
    const ungrounded = withSummary("台指期近月下跌 5.3%，跌幅明顯。");
    const { llm, requests } = fakeLlm([ungrounded, valid]);

    const result = await produce(llm);

    expect(result).toEqual({ status: "saved" });
    expect(requests).toHaveLength(2);
    const repair = requestAt(requests, 1);
    expect(repair.prompt).toContain("5.3");
    expect(repair.prompt).toContain(facts.text);
    expect(repair.prompt).toContain("不要引用資料來源說明");
    expect(repair.system).toBe(requestAt(requests, 0).system);
    const briefing = await stored();
    expect(briefing && textOf(briefing.content)).toEqual(textOf(valid));
    expect(await usageRows()).toHaveLength(2);
  });

  it("rejects and stores nothing when the repaired output is still ungrounded", async () => {
    const { llm, requests } = fakeLlm([
      withSummary("台指期近月下跌 5.3%，跌幅明顯。"),
      withSummary("成交量放大到 7.77 兆。"),
    ]);

    const result = await produce(llm);

    expect(result.status).toBe("rejected");
    expect(result.reasons?.join("\n")).toContain("7.77");
    expect(requests).toHaveLength(2);
    expect(await stored()).toBeNull();
    const usage = await usageRows();
    expect(usage).toHaveLength(2);
    expect(usage.every((row) => row.purpose === "briefing:daily:beginner")).toBe(true);
  });

  it("repairs an output that predicts tomorrow", async () => {
    const { llm, requests } = fakeLlm([withSummary("力度轉弱，明天大盤將上漲。"), valid]);

    const result = await produce(llm);

    expect(result).toEqual({ status: "saved" });
    expect(requestAt(requests, 1).prompt).toContain("明天大盤將上漲");
    const briefing = await stored();
    expect(briefing && textOf(briefing.content)).toEqual(textOf(valid));
  });

  it("rejects a prediction that survives the repair", async () => {
    const { llm } = fakeLlm([
      withSummary("力度轉弱，明天大盤將上漲。"),
      { ...valid, takeaway: "未來幾天可望反彈。" },
    ]);

    const result = await produce(llm);

    expect(result.status).toBe("rejected");
    expect(result.reasons?.join("\n")).toContain("未來幾天可望");
    expect(await stored()).toBeNull();
    expect(await usageRows()).toHaveLength(2);
  });

  it("repairs advice wording and lists the matched words in the repair prompt", async () => {
    const { llm, requests } = fakeLlm([withSummary("被動元件資金流入，可以逢低布局。"), valid]);

    expect(await produce(llm)).toEqual({ status: "saved" });

    const repair = requestAt(requests, 1).prompt;
    expect(repair).toContain("「逢低」");
    expect(repair).toContain("「布局」");
    expect(repair).toContain("買賣建議");
  });

  it("rejects advice wording or a link that survives the repair", async () => {
    const { llm } = fakeLlm([
      withSummary("現在加碼。"),
      { ...valid, takeaway: `詳見 www.example.com。${EDUCATION_DISCLAIMER}` },
    ]);

    const result = await produce(llm);

    expect(result.status).toBe("rejected");
    expect(result.reasons).toEqual(["link or contact: www.example.com"]);
    expect(await stored()).toBeNull();
  });

  it("repairs a link and stores the clean rewrite", async () => {
    const { llm, requests } = fakeLlm([withSummary("寫信到 a@b.tw 或看 https://x.io"), valid]);

    expect(await produce(llm)).toEqual({ status: "saved" });

    const repair = requestAt(requests, 1).prompt;
    expect(repair).toContain("「a@b.tw」");
    expect(repair).toContain("「https://x.io」");
  });

  it("checks section titles and bodies, not only the summary", async () => {
    const badSection: BriefingContent = {
      ...valid,
      sections: [
        { title: "大盤節奏", body: "力度 -0.63%、面積 +0.2%。" },
        { title: "成交 9.99 億", body: "被動元件：+57.44 億。" },
      ],
    };
    const { llm, requests } = fakeLlm([badSection, valid]);

    await produce(llm);

    expect(requests).toHaveLength(2);
    expect(requestAt(requests, 1).prompt).toContain("9.99");
  });

  it("drops glossary ids that do not exist", async () => {
    const { llm } = fakeLlm([{ ...valid, termIds: ["force", "nope"] }]);

    expect(await produce(llm)).toEqual({ status: "saved" });

    const termIds = (await stored())?.content.termIds;
    expect(termIds?.[0]).toBe("force");
    expect(termIds).not.toContain("nope");
  });

  it("adds the glossary terms the text uses when the model lists none", async () => {
    const text: BriefingContent = {
      headline: "今天的力度",
      summary: "力度 -0.63%，被動元件的內外盤金額差最高。",
      sections: [
        { title: "力度", body: "力度 -0.63%。" },
        { title: "資金", body: "內外盤金額差：被動元件 +57.44 億。" },
      ],
      takeaway: EDUCATION_DISCLAIMER,
      termIds: [],
    };
    const { llm } = fakeLlm([text]);

    await produce(llm);

    expect((await stored())?.content.termIds).toEqual(["force", "net-active-buy"]);
  });

  it("keeps the model's known ids first and collapses duplicates", async () => {
    const { llm } = fakeLlm([{ ...valid, termIds: ["area", "force", "area", "nope"] }]);

    await produce(llm);

    const termIds = (await stored())?.content.termIds ?? [];
    expect(termIds.slice(0, 2)).toEqual(["area", "force"]);
    expect(new Set(termIds).size).toBe(termIds.length);
    expect(termIds).toContain("taiex-futures");
    expect(termIds).toContain("net-active-buy");
    expect(termIds).not.toContain("nope");
  });

  it("skips without calling the LLM when the same prompt version is stored", async () => {
    await saveBriefing(db, {
      kind: "daily",
      periodKey: "2026-10-08",
      lens: "beginner",
      promptVersion: DAILY_PROMPT_VERSION,
      model: "old-model",
      content: valid,
    });
    const { llm, requests } = fakeLlm([valid]);

    expect(await produce(llm)).toEqual({ status: "skipped" });
    expect(requests).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  it("regenerates and replaces a briefing stored with a lower prompt version", async () => {
    await saveBriefing(db, {
      kind: "daily",
      periodKey: "2026-10-08",
      lens: "beginner",
      promptVersion: 1,
      model: "old-model",
      content: { ...valid, headline: "舊版標題" },
    });
    const { llm, requests } = fakeLlm([valid]);

    expect(await produce(llm, { promptVersion: 2 })).toEqual({ status: "saved" });

    expect(requests).toHaveLength(1);
    const briefing = await stored();
    expect(briefing?.promptVersion).toBe(2);
    expect(briefing?.model).toBe("fake-model");
    expect(briefing?.content.headline).toBe(valid.headline);
  });

  it("sends only the fact sheet and rules, never raw HTML or secrets", async () => {
    const { llm, requests } = fakeLlm([withSummary("下跌 5.3%。"), valid]);

    await produce(llm);

    expect(requests).toHaveLength(2);
    for (const { system, prompt } of requests) {
      expect(prompt).toContain(facts.text);
      for (const text of [system, prompt]) {
        expect(text).not.toContain("<html");
        expect(text).not.toContain("dO8m");
        expect(text).not.toContain(LLM_API_KEY);
      }
    }
  });

  it("propagates a model output error and stores no briefing", async () => {
    const { llm } = fakeLlm([new LlmOutputError("model output did not match the schema")]);

    await expect(produce(llm)).rejects.toBeInstanceOf(LlmOutputError);

    expect(await stored()).toBeNull();
    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ inputTokens: null, outputTokens: null });
  });

  it("records the usage a failed model call reports", async () => {
    const { llm } = fakeLlm([
      new LlmOutputError("model output failed validation", { inputTokens: 900, outputTokens: 70 }),
    ]);

    await expect(produce(llm)).rejects.toBeInstanceOf(LlmOutputError);

    const usage = await usageRows();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ inputTokens: 900, outputTokens: 70 });
  });

  it("propagates a model error during the repair call and stores no briefing", async () => {
    const { llm } = fakeLlm([withSummary("下跌 5.3%。"), new LlmOutputError("timed out")]);

    await expect(produce(llm)).rejects.toBeInstanceOf(LlmOutputError);

    expect(await stored()).toBeNull();
    expect(await usageRows()).toHaveLength(2);
  });
});
