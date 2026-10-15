import type { Db } from "@/db/client";
import { savePlanExplanation } from "@/db/repositories/plan-explanations";
import { toTaipei } from "@/market-clock/market-clock";
import { ALLOCATION_TABLE, type Slice } from "@/planner/rules/allocation";
import { LEVEL_NAMES } from "@/planner/rules/levels";
import type { RiskLevel } from "@/planner/rules/questionnaire";
import type { BriefingContent } from "./briefing-content";
import { LENSES, type Lens } from "./lens";
import { isoWeekKey } from "./week";

/** Prefix on every text field, so a sample briefing can never pass for a real one. */
export const SAMPLE_PREFIX = "【範例】";

/**
 * A fixed, clearly labelled placeholder daily briefing for local look-and-feel without an LLM
 * (`bun run briefing:sample`). It quotes no market figure, so it cannot misstate the data it sits
 * next to. Valid under `briefingContentSchema`.
 */
export function buildSampleBriefing(lens: Lens, tradeDate: string): BriefingContent {
  if (lens === "beginner") {
    return {
      headline: `${SAMPLE_PREFIX}這裡會是今天的一句話重點`,
      summary: `${SAMPLE_PREFIX}${tradeDate} 的範例摘要，正式內容由每日解讀產生。`,
      sections: [
        {
          title: "大盤在做什麼",
          body: `${SAMPLE_PREFIX}這一段會用白話說明加權指數今天是漲是跌、成交量大不大。這是開發用的範例文字，不代表任何真實行情。`,
        },
        {
          title: "哪些族群比較熱",
          body: `${SAMPLE_PREFIX}這一段會挑出資金比較集中的族群，並解釋「族群」是什麼意思。實際的數字請看下方的資料區塊。`,
        },
      ],
      takeaway: `${SAMPLE_PREFIX}這裡會是一句帶走的觀念，幫助你看懂盤後數字。`,
      termIds: ["sector", "turnover"],
    };
  }
  return {
    headline: `${SAMPLE_PREFIX}專業版盤後重點示意`,
    summary: `${SAMPLE_PREFIX}${tradeDate} 專業版範例摘要，正式內容由每日解讀產生。`,
    sections: [
      {
        title: "指數與量能",
        body: `${SAMPLE_PREFIX}此段會整理加權指數、台指期與成交值的變化。開發用範例，不含真實數據。`,
      },
      {
        title: "族群資金流向",
        body: `${SAMPLE_PREFIX}此段會依淨主動買、集中度與資金流象限整理強弱族群。開發用範例，不含真實數據。`,
      },
      {
        title: "盤面結構",
        body: `${SAMPLE_PREFIX}此段會說明漲跌家數與鎖漲停、鎖跌停的分布。開發用範例，不含真實數據。`,
      },
    ],
    takeaway: `${SAMPLE_PREFIX}此處為專業版的觀察摘要示意。`,
    termIds: ["net-active-buy", "concentration-ratio", "flow-quadrant", "limit-locked"],
  };
}

const SLICE_NAMES: readonly { slice: Slice; name: string }[] = [
  { slice: "core", name: "核心" },
  { slice: "bond", name: "債券" },
  { slice: "dividend", name: "高股息" },
  { slice: "satellite", name: "衛星" },
  { slice: "cash", name: "現金" },
];

/** The level's held slices as "核心 45%、債券 25%…", straight from the signed-off table. */
function allocationText(level: RiskLevel): string {
  const row = ALLOCATION_TABLE[level];
  return SLICE_NAMES.filter(({ slice }) => row[slice] > 0)
    .map(({ slice, name }) => `${name} ${row[slice]}%`)
    .join("、");
}

/**
 * A fixed, clearly labelled placeholder plan explanation for local look-and-feel without an LLM
 * (`bun run briefing:sample`). Every text field starts with `SAMPLE_PREFIX`. The only figures it
 * quotes are the level's allocation percentages from `ALLOCATION_TABLE`, so it cannot misstate a
 * number; it holds no historical figure. Cites plan glossary ids only. Valid under
 * `briefingContentSchema`.
 */
export function buildSamplePlanExplanation(level: RiskLevel, lens: Lens): BriefingContent {
  const name = LEVEL_NAMES[level];
  const allocation = allocationText(level);
  if (lens === "beginner") {
    return {
      headline: `${SAMPLE_PREFIX}${name}配置的說明會放在這裡`,
      summary: `${SAMPLE_PREFIX}這是開發用的範例文字，正式說明由每週的資料整理產生。`,
      sections: [
        {
          title: `${SAMPLE_PREFIX}配置比例`,
          body: `${SAMPLE_PREFIX}${name}配置的目標比例是：${allocation}。這一段會用白話說明每一塊的角色。`,
        },
        {
          title: `${SAMPLE_PREFIX}歷史試算`,
          body: `${SAMPLE_PREFIX}這一段會說明這個配置過去的試算結果，並解釋最大回撤是什麼意思。範例文字不含任何真實的歷史數字。`,
        },
      ],
      takeaway: `${SAMPLE_PREFIX}這裡會是一句帶走的觀念。`,
      termIds: ["rebalance", "max-drawdown"],
    };
  }
  return {
    headline: `${SAMPLE_PREFIX}${name}配置的專業版說明`,
    summary: `${SAMPLE_PREFIX}專業版範例摘要，正式說明由每週的資料整理產生。`,
    sections: [
      {
        title: `${SAMPLE_PREFIX}配置與再平衡`,
        body: `${SAMPLE_PREFIX}${name}配置的目標比例是：${allocation}。此段會說明各部位的標的與每年再平衡的做法。`,
      },
      {
        title: `${SAMPLE_PREFIX}歷史試算指標`,
        body: `${SAMPLE_PREFIX}此段會整理年化報酬率、最大回撤與年化波動度。開發用範例，不含真實數據。`,
      },
    ],
    takeaway: `${SAMPLE_PREFIX}此處為專業版的觀察摘要示意。`,
    termIds: ["cagr", "max-drawdown", "volatility", "rebalance"],
  };
}

/** Marks a sample row; any real row has a hash here, so a real row never matches it. */
export const SAMPLE_PLAN_FINGERPRINT = "sample";
/** Samples are stored at prompt version 0, so a real explanation (version >= 1) replaces them. */
export const SAMPLE_PLAN_PROMPT_VERSION = 0;

/**
 * Stores the ten sample plan explanations (five levels × two lenses) for the ISO week of `now`
 * in Taipei, at version 0 with model "sample". Idempotent: a row already stored for this week
 * (sample or real) is kept, and a real row (version >= 1) always wins.
 */
export async function seedSamplePlanExplanations(
  db: Db,
  now: Date,
): Promise<{ saved: number; total: number }> {
  const periodKey = isoWeekKey(toTaipei(now).date);
  let saved = 0;
  let total = 0;
  for (const level of [1, 2, 3, 4, 5] as const) {
    for (const lens of LENSES) {
      total++;
      const result = await savePlanExplanation(db, {
        level,
        lens,
        periodKey,
        promptVersion: SAMPLE_PLAN_PROMPT_VERSION,
        model: "sample",
        content: buildSamplePlanExplanation(level, lens),
        factsFingerprint: SAMPLE_PLAN_FINGERPRINT,
      });
      if (result.saved) saved++;
    }
  }
  return { saved, total };
}
