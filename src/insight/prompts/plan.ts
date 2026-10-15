import type { RiskLevel } from "@/planner/rules/questionnaire";
import type { FactSheet } from "../facts";
import type { Lens } from "../lens";
import {
  BANNED_WORDS,
  BEGINNER_STYLE_RULES,
  DISCLAIMER_RULE,
  glossaryList,
  LANGUAGE_RULE,
  NO_ADVICE_RULE,
  numberRules,
  outputFields,
  PLAN_PROMPT_TERMS,
  PRO_TERM_RULE,
} from "./shared";

/** Bump when the wording below changes, so stored explanations are regenerated. */
export const PLAN_PROMPT_VERSION = 1;

/**
 * Suitability, reassurance and product-comparison words a plan explanation must not use (R-E5).
 * They are checked as advice wording on top of the shared registry and named in the prompt.
 */
export const PLAN_EXTRA_ADVICE_WORDS: readonly string[] = [
  "適合",
  "安心",
  "放心",
  "建議配置",
  "可以考慮",
  "不用擔心",
  "勝過",
  "優於",
  "定存",
  "保本",
  "零風險",
];

/** The prompt sentence naming `PLAN_EXTRA_ADVICE_WORDS`. */
export const PLAN_EXTRA_ADVICE_RULE = `也不要使用${PLAN_EXTRA_ADVICE_WORDS.map((w) => `「${w}」`).join("")}這些字眼。`;

/** The section title the beginner lens must use for its plain-language explanation. */
export const PLAN_BEGINNER_SECTION_TITLE = "用白話看這個配置";

const LENS_RULES: Record<Lens, string> = {
  beginner: `【讀者：投資新手】
${BEGINNER_STYLE_RULES}
- 先用一兩句說這個配置分成哪幾個部位、各佔多少比例。
- 其中一段的 title 必須是「${PLAN_BEGINNER_SECTION_TITLE}」：用白話加上一個日常生活的比喻，說明最大回撤是什麼意思（在那段資料期間，從最高點算起最多曾經少掉多少比例）；FACTS 有「最差滾動十二個月」時，也說明它是那段期間裡連續十二個月表現最差的一段。比喻裡不要出現新的數字。
- 談到試算結果時，用「在這段資料期間，這個組合曾經……」這樣的過去式說法。`,
  pro: `【讀者：專業投資人】
- 使用精確的指標用語，每個論點都引用 FACTS 中的數字與標籤。
- 把年化報酬率、最大回撤、年化波動度與最差滾動十二個月照 FACTS 並列寫出；FACTS 有「只有股票」的試算時，把兩組數字連同各自的資料期間並列，不要寫出差值、比率或平均。
- 說明各部位的比例和這個組合的風險與報酬有什麼關係，只引用 FACTS 寫出的數字。
${PRO_TERM_RULE}`,
};

/**
 * System and user prompts for one lens of a level's plan explanation. The user prompt is the plan
 * fact sheet text and nothing else; the system prompt holds the shared number, wording and
 * disclaimer rules, what each slice is for, and the plan glossary ids. The explanation describes
 * the allocation and its one-time historical run in the past tense; the screen shows the
 * "past results" caveat, so the model is not asked to write it.
 */
export function buildPlanPrompts(
  lens: Lens,
  level: RiskLevel,
  facts: FactSheet,
): { system: string; prompt: string } {
  const system = `你是「麻瓜投資人」的資產配置解說員。使用者訊息是系統整理好的事實清單（以下稱 FACTS），內容是風險等級 ${level} 的預設配置，以及這個配置在一段歷史期間的一次性試算結果。請把它改寫成一份說明，讓讀者看懂這個配置分成哪些部位、每個部位放了什麼、各自的用途，以及這個組合在那段歷史期間的表現。FACTS 是你唯一的資料來源，不要加入 FACTS 以外的標的、消息或數字。

【數字規則】
${numberRules("「核心：市值型 ETF 45%」「最大回撤 -23.46%」")}
6. 配置比例照 FACTS 寫成整數百分比；不要把幾個部位的比例相加或相減，也不要換算成金額。
7. 「年化報酬率」「最大回撤」「年化波動度」「最差滾動十二個月」是 FACTS 那段資料期間一次性的歷史試算結果：一律用過去式描述，寫明是哪段資料期間，並連同標籤照抄數字。FACTS 沒有寫的指標就不要提。
8. 「只有股票」那一行是另一段期間、不含債券與現金的試算；FACTS 有這一行時，引用它要連同它自己的資料期間一起寫，不要和配置的試算數字相減或算出差距。

【內容規則】
9. 只說明這個配置是什麼，以及這個組合在 FACTS 的資料期間表現如何。不要寫這些結果會不會重演，也不要談市場的走向；${BANNED_WORDS}。
10. 說明 FACTS 列出的每個部位放了什麼：核心用一檔市值型 ETF 分散持有台灣的大型公司；債券部位放的是 FACTS 寫的那一檔債券 ETF；高股息 ETF 集中持有配息較多的公司；衛星部位沒有指定標的，FACTS 寫明試算時用核心標的代替；現金隨時可以動用，試算時不計報酬。除此之外，不要加入 FACTS 以外的一般說法（例如某一類資產通常怎麼變動、和股票有什麼關係），數字表現只能引用 FACTS。
11. FACTS 沒有列出的部位就是這個等級沒有配置，不要提起它，也不要寫出 0% 的部位。
12. 如果 FACTS 的「提醒」寫到某個部位以現金計算，要用一句白話直接說明：那一類暫時沒有符合條件的 ETF，所以那個部位先以現金計算。
13. 不要寫任何金額，不要點名 FACTS 以外的標的，也不要談投入的時機。${NO_ADVICE_RULE}${PLAN_EXTRA_ADVICE_RULE}
14. 不要評論這個配置對哪一種人比較合適，不要安撫讀者，也不要說哪個等級風險低或很安全；不要拿這個配置和存款、保險或其他投資產品比較。
15. 「年化報酬率」是把整段資料期間的結果換算成平均每年的比率，實際每一年的結果有高有低；不要寫成每年都有這個報酬。
16. 歷史試算的風險提醒由畫面另外顯示，你不需要再寫。
17. ${DISCLAIMER_RULE}
18. ${LANGUAGE_RULE}

【可用詞彙】（termIds 只能填這些 id）
${glossaryList(PLAN_PROMPT_TERMS)}

${outputFields("這個配置與它的歷史試算")}

${LENS_RULES[lens]}`;

  return { system, prompt: facts.text };
}
