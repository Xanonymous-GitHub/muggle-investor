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
import { type Llm, LlmOutputError, type LlmUsage } from "./llm";

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

export type ValidatedDeps = ProduceDeps;

export type ValidatedRequest = {
  /** The `llm_usage` purpose recorded for every call. */
  purpose: string;
  /** Extra fields for the warn logs (which briefing or explanation this is). */
  context: Record<string, string | number>;
  system: string;
  prompt: string;
  facts: FactSheet;
  /** False for text narrating a past week, where "週一開盤" is not a next-session reference. */
  weekdaySessions: boolean;
  /** What the text is called in the repair prompt (zh) and the warn logs (en); default a briefing. */
  noun?: Noun;
  /** Words rejected as advice on top of the shared registry (default none). */
  extraAdviceWords?: readonly string[];
};

type Noun = { zh: string; en: string };

const BRIEFING_NOUN: Noun = { zh: "簡報", en: "briefing" };

export type ValidatedResult =
  | { status: "ok"; content: BriefingContent; termIds: string[] }
  | { status: "rejected"; reasons: string[] };

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

/** Every occurrence of each of `words` in `text`, in list order. */
const findWords = (text: string, words: readonly string[]): string[] =>
  words.flatMap((word) =>
    word
      ? text
          .split(word)
          .slice(1)
          .map(() => word)
      : [],
  );

function findViolations(
  content: BriefingContent,
  facts: FactSheet,
  req: ValidatedRequest,
): Violations {
  const text = readableText(content);
  return {
    ungrounded: checkGrounding(text, facts).ungrounded,
    predictions: findForbiddenPredictions(text, { weekdaySessions: req.weekdaySessions }),
    advice: [...findAdviceWording(text), ...findWords(text, req.extraAdviceWords ?? [])],
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
function repairPrompt(prompt: string, v: Violations, noun: string): string {
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

你上一版的${noun}沒有通過檢查：
${problems.join("\n")}
請只使用上面 FACTS 裡的數字與事實，重寫一份完整的${noun}（每個欄位都重新輸出）。數字照 FACTS 原樣抄寫，不要計算新的數字，不要談明天或未來的走勢，不要給買賣建議，不要放網址，也不要引用資料來源說明。`;
}

/**
 * Generates and validates one `BriefingContent`-shaped text without storing it. Every LLM call
 * records an `llm_usage` row under `purpose`, including calls whose output is rejected and calls
 * that throw (with the usage the `LlmOutputError` carries, else null token counts). Output with a
 * number the facts do not support, a prediction, advice wording or a link gets one repair call; if
 * that also fails, the result is `rejected` with the reasons. `termIds` are the model's known
 * glossary ids plus every glossary term found in the text (unknown ids are dropped). An
 * `LlmOutputError` from the model propagates.
 */
export async function produceValidated(
  deps: ValidatedDeps,
  req: ValidatedRequest,
): Promise<ValidatedResult> {
  const { db, llm, logger, now } = deps;
  const { purpose, context } = req;
  const noun = req.noun ?? BRIEFING_NOUN;

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
      // The calls were still made (and may have been billed): record what the adapter counted,
      // or null tokens when it could not say.
      await record(
        error instanceof LlmOutputError ? error.usage : { inputTokens: null, outputTokens: null },
      );
      throw error;
    }
    await record(result.usage);
    return result.object;
  };

  let content = await generate(req.prompt);
  let violations = findViolations(content, req.facts, req);
  if (hasViolations(violations)) {
    logger.warn(
      { ...context, reasons: describeViolations(violations) },
      `${noun.en} failed validation; retrying once`,
    );
    content = await generate(repairPrompt(req.prompt, violations, noun.zh));
    violations = findViolations(content, req.facts, req);
    if (hasViolations(violations)) {
      const reasons = describeViolations(violations);
      logger.warn({ ...context, reasons }, `${noun.en} rejected after repair`);
      return { status: "rejected", reasons };
    }
  }

  const unknownTermIds = content.termIds.filter((id) => getTerm(id) === undefined);
  if (unknownTermIds.length > 0) {
    logger.warn({ ...context, unknownTermIds }, `dropping unknown glossary ids from ${noun.en}`);
  }
  // The model's known ids first, then every glossary term the text actually uses, deduplicated.
  const termIds = [
    ...new Set([
      ...content.termIds.filter((id) => getTerm(id) !== undefined),
      ...findTermsInText(readableText(content)),
    ]),
  ];
  return { status: "ok", content, termIds };
}

/**
 * Generates, validates (via `produceValidated`) and stores one briefing. Skips (no LLM call) when
 * a briefing with at least `promptVersion` is stored. Usage is recorded under
 * `briefing:<kind>:<lens>`; a weekly narrates a past week, so weekday-session wording is allowed
 * there. A rejected output stores nothing; an `LlmOutputError` propagates without storing.
 */
export async function produceBriefing(
  deps: ProduceDeps,
  req: ProduceRequest,
): Promise<ProduceResult> {
  const { db, llm, now } = deps;
  if (await hasBriefing(db, req.kind, req.periodKey, req.lens, req.promptVersion)) {
    return { status: "skipped" };
  }

  const result = await produceValidated(deps, {
    purpose: `briefing:${req.kind}:${req.lens}`,
    context: { kind: req.kind, periodKey: req.periodKey, lens: req.lens },
    system: req.system,
    prompt: req.prompt,
    facts: req.facts,
    weekdaySessions: req.kind !== "weekly",
  });
  if (result.status === "rejected") return { status: "rejected", reasons: result.reasons };

  const { saved } = await saveBriefing(db, {
    kind: req.kind,
    periodKey: req.periodKey,
    lens: req.lens,
    promptVersion: req.promptVersion,
    model: llm.modelId,
    content: { ...result.content, termIds: result.termIds },
    ...(now && { createdAt: now() }),
  });
  // Not saved when a briefing with an equal or newer prompt version was stored meanwhile.
  return { status: saved ? "saved" : "skipped" };
}
