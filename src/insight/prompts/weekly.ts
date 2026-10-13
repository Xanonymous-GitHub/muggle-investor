import type { FactSheet } from "../facts";
import type { Lens } from "../lens";
import {
  BANNED_WORDS,
  BEGINNER_STYLE_RULES,
  DISCLAIMER_RULE,
  glossaryList,
  LANGUAGE_RULE,
  meaningSectionRule,
  NO_ADVICE_RULE,
  numberRules,
  outputFields,
  PRO_TERM_RULE,
} from "./shared";

/** Bump when the wording below changes, so stored briefings are regenerated. */
export const WEEKLY_PROMPT_VERSION = 1;

/** The section title the beginner lens must use for its plain-language explanation. */
export const WEEKLY_BEGINNER_SECTION_TITLE = "這週對你意味著什麼";

const LENS_RULES: Record<Lens, string> = {
  beginner: `【讀者：投資新手】
${BEGINNER_STYLE_RULES}
- 先說這一週台指期整體是漲還是跌，再挑出上榜天數最多的族群，說明這一週盤面的主角是誰。
${meaningSectionRule(WEEKLY_BEGINNER_SECTION_TITLE, "這一週")}`,
  pro: `【讀者：專業投資人】
- 使用精確的指標用語，每個論點都引用 FACTS 中的數字。
- 逐日比較力度與面積時，把各交易日的數字照 FACTS 並列寫出，不要寫出差值或平均。
- 說明哪些族群反覆出現在漲幅榜與跌幅榜，以及內外盤金額差上榜累計集中在哪些族群。
- 說明本週的象限轉換，照 FACTS 寫出日期與轉換方向。
${PRO_TERM_RULE}`,
};

/**
 * System and user prompts for one lens of a weekly briefing. The user prompt is the weekly fact
 * sheet text and nothing else; the system prompt holds the shared number and content rules, the
 * weekly figures' meaning (pre-computed week change, 上榜累計) and the glossary ids. The data
 * source's caveats are not included: they are written about a single day ("今天"), and the one
 * that matters — 內外盤金額差 says nothing about later returns — is stated as rule 9.
 */
export function buildWeeklyPrompts(
  lens: Lens,
  facts: FactSheet,
): { system: string; prompt: string } {
  const system = `你是「麻瓜投資人」的台股盤後解說員。使用者訊息是系統從這一週每日資料整理好的事實清單（以下稱 FACTS），請把它改寫成一份週報，回顧這一週已經發生的盤面。FACTS 是你唯一的資料來源，不要加入 FACTS 以外的消息、個股或數字。

【數字規則】
${numberRules("「力度 -0.63%」「被動元件：上榜累計 +114.88 億（上榜 2 天）」")}
6. 本週台指期的漲跌點數與漲跌幅已經算好，照「本週台指期近月」那一行抄寫；不要把每日的漲跌相加，也不要自己重算。
7. 「上榜累計」只加總該族群列入當日淨流入或淨流出榜的交易日，不是整週的總額；引用時連同「上榜累計」標籤與上榜天數一起寫，不要說成整週合計。

【內容規則】
8. 只回顧這一週已經發生的盤面。不要談下週或之後的走勢，也不要暗示漲跌會延續或反轉；${BANNED_WORDS}。
9. 內外盤金額差只描述已經發生的買賣力道，不要用它推論之後的走勢。
10. 「先前的每日簡報摘要」是先前寫好的單日簡報，只用來理解當天重點，不要整段照抄，也不要引用其中的數字；數字只能用它上面各行寫出的。
11. ${NO_ADVICE_RULE}
12. ${DISCLAIMER_RULE}
13. ${LANGUAGE_RULE}

【可用詞彙】（termIds 只能填這些 id）
${glossaryList()}

${outputFields("這一週的盤面")}

${LENS_RULES[lens]}`;

  return { system, prompt: facts.text };
}
