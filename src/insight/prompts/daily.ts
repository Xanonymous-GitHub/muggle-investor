import { GLOSSARY, type GlossaryCategory } from "@/glossary";
import type { FactSheet } from "../facts";
import type { Lens } from "../lens";

/** Bump when the wording below changes, so stored briefings are regenerated. */
export const DAILY_PROMPT_VERSION = 1;

/**
 * The one sentence every briefing must carry. Worded without 保證／預測／預期 and without
 * future-time words, because `findForbiddenPredictions` flags those even in a negated disclaimer.
 */
export const EDUCATION_DISCLAIMER = "以上為資料整理與教育說明，不構成投資建議";

/** Daily briefings describe the market, so planning terms are not offered. */
const PROMPT_CATEGORIES: ReadonlySet<GlossaryCategory> = new Set(["market", "flow", "limit"]);
/** Market-category terms that still pull the text towards product or advice framing. */
const EXCLUDED_TERM_IDS: ReadonlySet<string> = new Set(["etf"]);

/** Glossary terms the daily prompts offer for `termIds`. */
export const DAILY_PROMPT_TERMS = GLOSSARY.filter(
  (term) => PROMPT_CATEGORIES.has(term.category) && !EXCLUDED_TERM_IDS.has(term.id),
);

const glossaryList = (): string =>
  DAILY_PROMPT_TERMS.map((term) => `- ${term.id}：${term.term}`).join("\n");

const LENS_RULES: Record<Lens, string> = {
  beginner: `【讀者：投資新手】
- 句子要短，一句只講一件事，用日常說法，不要堆疊術語。
- 只使用「可用詞彙」裡的專有名詞，每用到一個就把它的 id 放進 termIds；不在清單裡的術語不要用。
- 其中一段的 title 必須是「這對你意味著什麼」：用白話加上一個日常生活的比喻，說明今天的盤面代表什麼。這一段只解釋現象，不叫讀者買或賣，比喻裡也不要出現新的數字。`,
  pro: `【讀者：專業投資人】
- 使用精確的指標用語，每個論點都引用 FACTS 中的數字。
- 討論力度與面積是否背離（例如力度為負、面積為正）。要和前一交易日比較時，把今天與前一交易日的力度、面積照 FACTS 並列寫出，不要寫出差值。
- 四象限族群數同樣把今天與前一交易日的數字並列寫出，不要寫出差值；再說明主要族群的象限轉換。
- 說明漲跌停的分布，以及漲停鎖死集中在哪些族群。
- 用到「可用詞彙」裡的專有名詞時，把它的 id 放進 termIds。`,
};

/**
 * System and user prompts for one lens of a daily briefing. The user prompt is the fact sheet
 * text and nothing else; the system prompt holds the rules, the data source's caveats (verbatim,
 * framed as background the model must not copy: one of them trips `findForbiddenPredictions`)
 * and the glossary ids. Neither ever contains raw HTML or credentials.
 */
export function buildDailyPrompts(
  lens: Lens,
  facts: FactSheet,
  caveats: string[],
): { system: string; prompt: string } {
  const system = `你是「麻瓜投資人」的台股盤後解說員。使用者訊息是系統從當日資料整理好的事實清單（以下稱 FACTS），請把它改寫成一份當日盤後簡報。FACTS 是你唯一的資料來源，不要加入 FACTS 以外的消息、個股或數字。

【數字規則】
1. 只能使用 FACTS 裡寫出的數字，並連同它的標籤照原樣抄寫，例如「力度 -0.63%」「被動元件：+57.44 億」。
2. FACTS 寫到小數第二位的數字，最多只能少寫一位小數（-1.24% 可寫成 -1.2%，不能寫成 -1%）；FACTS 裡的整數照抄。
3. 不要自己算出新的數字：不加總、不相減、不算比率或倍數，也不換算單位（不要把「億」改寫成「兆」或「萬」）。
4. 不要提到 FACTS 裡沒有的日期或時間。
5. 數字一律使用 FACTS 裡的阿拉伯數字，不要改寫成中文數字。

【內容規則】
6. 只描述這個交易日已經發生的盤面。不要談明天、下週或未來的走勢，也不要暗示漲跌會延續或反轉；不要使用「明天」「明日」「隔天」「下週」「下周」「下個交易日」「未來」「預期」「預測」「可望」「保證」這些字眼。
7. 不提供買賣建議，不承諾任何結果。
8. 在 takeaway 或最後一段中，原封不動寫出這一句，全文只寫一次：「${EDUCATION_DISCLAIMER}」。
9. 使用台灣繁體中文。

【資料來源原始說明】（供你理解資料用，不要抄進簡報；其中「以下數字」指使用者訊息中的 FACTS，「詞彙表」指下面的【可用詞彙】）
${caveats.map((caveat) => `- ${caveat}`).join("\n")}

【可用詞彙】（termIds 只能填這些 id）
${glossaryList()}

【輸出欄位】
- headline：一句標題，40 字以內。
- summary：一句話總結今天的盤面，120 字以內。
- sections：2 到 4 段，每段有 title（24 字以內）與 body（600 字以內）。
- takeaway：收尾重點，160 字以內。
- termIds：文中用到的可用詞彙 id。

${LENS_RULES[lens]}`;

  return { system, prompt: facts.text };
}
