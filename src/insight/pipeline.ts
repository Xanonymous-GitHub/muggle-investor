import type { Logger } from "pino";
import type { Db } from "@/db/client";
import { type BriefingKind, hasBriefing, saveBriefing } from "@/db/repositories/briefings";
import { recordLlmUsage } from "@/db/repositories/llm-usage";
import { findTermsInText, getTerm } from "@/glossary";
import { type BriefingContent, briefingContentSchema } from "./briefing-content";
import type { FactSheet } from "./facts";
import {
  checkGrounding,
  findAdviceWording,
  findForbiddenPredictions,
  findLinks,
} from "./grounding";
import type { Lens } from "./lens";
import type { Llm, LlmUsage } from "./llm";

export type ProduceRequest = {
  kind: BriefingKind;
  periodKey: string;
  lens: Lens;
  promptVersion: number;
  system: string;
  prompt: string;
  facts: FactSheet;
};

export type ProduceResult = { status: "saved" | "skipped" | "rejected"; reasons?: string[] };

export type ProduceDeps = { db: Db; llm: Llm; logger: Logger; now?: () => Date };

type Violations = {
  ungrounded: number[];
  predictions: string[];
  advice: string[];
  links: string[];
};

/** Every text field a reader sees; this is what the validators check. */
const readableText = (content: BriefingContent): string =>
  [
    content.headline,
    content.summary,
    ...content.sections.flatMap((section) => [section.title, section.body]),
    content.takeaway,
  ].join("\n");

function findViolations(content: BriefingContent, facts: FactSheet): Violations {
  const text = readableText(content);
  return {
    ungrounded: checkGrounding(text, facts).ungrounded,
    predictions: findForbiddenPredictions(text),
    advice: findAdviceWording(text),
    links: findLinks(text),
  };
}

const hasViolations = (v: Violations) =>
  v.ungrounded.length > 0 || v.predictions.length > 0 || v.advice.length > 0 || v.links.length > 0;

const quoted = (snippets: string[]) => snippets.map((s) => `「${s}」`).join("、");

function describeViolations(v: Violations): string[] {
  return [
    ...(v.ungrounded.length > 0 ? [`ungrounded numbers: ${v.ungrounded.join(", ")}`] : []),
    ...v.predictions.map((snippet) => `forbidden prediction: ${snippet}`),
    ...v.advice.map((snippet) => `advice wording: ${snippet}`),
    ...v.links.map((snippet) => `link or contact: ${snippet}`),
  ];
}

/** The original prompt plus the concrete violations, asking for a full rewrite from FACTS only. */
function repairPrompt(prompt: string, v: Violations): string {
  const problems = [
    ...(v.ungrounded.length > 0
      ? [`- 這些數字不在 FACTS 裡，也不是 FACTS 數字的合理四捨五入：${v.ungrounded.join("、")}`]
      : []),
    ...(v.predictions.length > 0
      ? [`- 這些文字在談未來走勢或做出保證，不允許出現：${quoted(v.predictions)}`]
      : []),
    ...(v.advice.length > 0
      ? [`- 這些字眼是買賣建議或行動呼籲，不允許出現：${quoted(v.advice)}`]
      : []),
    ...(v.links.length > 0 ? [`- 這些是網址、網域或電子郵件，不允許出現：${quoted(v.links)}`] : []),
  ];
  return `${prompt}

你上一版的簡報沒有通過檢查：
${problems.join("\n")}
請只使用上面 FACTS 裡的數字與事實，重寫一份完整的簡報（每個欄位都重新輸出）。數字照 FACTS 原樣抄寫，不要計算新的數字，不要談明天或未來的走勢，不要給買賣建議，不要放網址，也不要引用資料來源說明。`;
}

/**
 * Generates, validates and stores one briefing. Skips (no LLM call) when a briefing with at least
 * `promptVersion` is stored. Every LLM call records an `llm_usage` row, including calls whose
 * output is rejected and calls that throw (with null token counts). Output with a number the facts
 * do not support, a prediction, advice wording or a link gets one repair call; if that also fails, nothing is stored and
 * the result is `rejected` with the reasons. Stored `termIds` are the model's known glossary ids
 * plus every glossary term found in the text (unknown ids are dropped). An `LlmOutputError`
 * from the model propagates without storing a briefing.
 */
export async function produceBriefing(
  deps: ProduceDeps,
  req: ProduceRequest,
): Promise<ProduceResult> {
  const { db, llm, logger, now } = deps;
  if (await hasBriefing(db, req.kind, req.periodKey, req.lens, req.promptVersion)) {
    return { status: "skipped" };
  }

  const purpose = `briefing:${req.kind}:${req.lens}`;
  const context = { kind: req.kind, periodKey: req.periodKey, lens: req.lens };

  const record = (usage: LlmUsage) =>
    recordLlmUsage(db, { purpose, model: llm.modelId, usage, ...(now && { createdAt: now() }) });

  const generate = async (prompt: string): Promise<BriefingContent> => {
    let result: { object: BriefingContent; usage: LlmUsage };
    try {
      result = await llm.generateObject({
        system: req.system,
        prompt,
        schema: briefingContentSchema,
      });
    } catch (error) {
      // The call was still made (and may have been billed); its token counts are unknown.
      await record({ inputTokens: null, outputTokens: null });
      throw error;
    }
    await record(result.usage);
    return result.object;
  };

  let content = await generate(req.prompt);
  let violations = findViolations(content, req.facts);
  if (hasViolations(violations)) {
    logger.warn(
      { ...context, reasons: describeViolations(violations) },
      "briefing failed validation; retrying once",
    );
    content = await generate(repairPrompt(req.prompt, violations));
    violations = findViolations(content, req.facts);
    if (hasViolations(violations)) {
      const reasons = describeViolations(violations);
      logger.warn({ ...context, reasons }, "briefing rejected after repair");
      return { status: "rejected", reasons };
    }
  }

  const unknownTermIds = content.termIds.filter((id) => getTerm(id) === undefined);
  if (unknownTermIds.length > 0) {
    logger.warn({ ...context, unknownTermIds }, "dropping unknown glossary ids from briefing");
  }
  // The model's known ids first, then every glossary term the text actually uses, deduplicated.
  const termIds = [
    ...new Set([
      ...content.termIds.filter((id) => getTerm(id) !== undefined),
      ...findTermsInText(readableText(content)),
    ]),
  ];

  const { saved } = await saveBriefing(db, {
    kind: req.kind,
    periodKey: req.periodKey,
    lens: req.lens,
    promptVersion: req.promptVersion,
    model: llm.modelId,
    content: { ...content, termIds },
    ...(now && { createdAt: now() }),
  });
  // Not saved when a briefing with an equal or newer prompt version was stored meanwhile.
  return { status: saved ? "saved" : "skipped" };
}
