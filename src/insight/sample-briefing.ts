import type { BriefingContent } from "./briefing-content";
import type { Lens } from "./lens";

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
