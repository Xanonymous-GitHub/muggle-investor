import { GLOSSARY, type GlossaryCategory, type GlossaryTerm } from "@/glossary";
import { ADVICE_WORDS, FORECAST_WORDS, FUTURE_WORDS, GUARANTEE_WORDS } from "../forbidden-wording";

/**
 * Prompt pieces shared by the daily and weekly briefings, so both ask for the same number
 * handling, banned words, disclaimer and glossary.
 */

/**
 * The one sentence every briefing must carry. Worded without 保證／預測／預期 and without
 * future-time words, because `findForbiddenPredictions` flags those even in a negated disclaimer.
 */
export const EDUCATION_DISCLAIMER = "以上為資料整理與教育說明，不構成投資建議";

/** Briefings describe the market, so planning terms are not offered. */
const PROMPT_CATEGORIES: ReadonlySet<GlossaryCategory> = new Set(["market", "flow", "limit"]);
/** Market-category terms that still pull the text towards product or advice framing. */
const EXCLUDED_TERM_IDS: ReadonlySet<string> = new Set(["etf"]);

/** Glossary terms the briefing prompts offer for `termIds`. */
export const PROMPT_TERMS = GLOSSARY.filter(
  (term) => PROMPT_CATEGORIES.has(term.category) && !EXCLUDED_TERM_IDS.has(term.id),
);

/**
 * Glossary terms the plan-explanation prompts offer: the planning terms plus `etf`, which the
 * briefings leave out but a plan about ETFs needs.
 */
export const PLAN_PROMPT_TERMS = GLOSSARY.filter(
  (term) => term.category === "planning" || term.id === "etf",
);

/** `terms` (default: the briefing set) as "- id：term" lines. */
export const glossaryList = (terms: readonly GlossaryTerm[] = PROMPT_TERMS): string =>
  terms.map((term) => `- ${term.id}：${term.term}`).join("\n");

/**
 * Rules 1–5: copy figures from FACTS with their labels; never compute new ones. `labelExamples`
 * shows labelled figures in the briefing's own fact format, e.g. 「力度 -0.63%」.
 */
export const numberRules = (
  labelExamples: string,
): string => `1. 只能使用 FACTS 裡寫出的數字，並連同它的標籤照原樣抄寫，例如${labelExamples}。
2. FACTS 寫到小數第二位的數字，最多只能少寫一位小數（-1.24% 可寫成 -1.2%，不能寫成 -1%）；FACTS 裡的整數照抄。
3. 不要自己算出新的數字：不加總、不相減、不算比率或倍數，也不換算單位（不要把「億」改寫成「兆」或「萬」）。
4. 不要提到 FACTS 裡沒有的日期或時間。
5. 數字一律使用 FACTS 裡的阿拉伯數字，不要改寫成中文數字。`;

const quoteAll = (words: readonly string[]): string => words.map((w) => `「${w}」`).join("");

/**
 * Every future-time, forecast and guarantee word `findForbiddenPredictions` looks for, plus the
 * forward-looking 預期／可望, all taken from the shared registry.
 */
export const PROMPT_BANNED_WORDS: readonly string[] = [
  ...new Set([...FUTURE_WORDS, "預期", ...FORECAST_WORDS, "可望", ...GUARANTEE_WORDS]),
];

export const BANNED_WORDS = `不要使用${quoteAll(PROMPT_BANNED_WORDS)}這些字眼，也不要寫「週一開盤」這類指向下一個交易日的說法`;

/** The advice words `findAdviceWording` rejects and the links `findLinks` rejects. */
export const NO_ADVICE_RULE = `不提供買賣建議，不承諾任何結果；不要使用${quoteAll(ADVICE_WORDS)}這些字眼，也不要寫出任何網址或電子郵件。`;

export const DISCLAIMER_RULE = `在 takeaway 或最後一段中，原封不動寫出這一句，全文只寫一次：「${EDUCATION_DISCLAIMER}」。`;

export const LANGUAGE_RULE = "使用台灣繁體中文。";

/** The opening style rules of the beginner lens. */
export const BEGINNER_STYLE_RULES = `- 句子要短，一句只講一件事，用日常說法，不要堆疊術語。
- 只使用「可用詞彙」裡的專有名詞，每用到一個就把它的 id 放進 termIds；不在清單裡的術語不要用。`;

/** The beginner lens's plain-language section, titled `title`, about `period` ("今天"). */
export const meaningSectionRule = (title: string, period: string): string =>
  `- 其中一段的 title 必須是「${title}」：用白話加上一個日常生活的比喻，說明${period}的盤面代表什麼。這一段只解釋現象，不叫讀者買或賣，比喻裡也不要出現新的數字。`;

export const PRO_TERM_RULE = "- 用到「可用詞彙」裡的專有名詞時，把它的 id 放進 termIds。";

/** The output field list; `summaryScope` is what the summary sums up ("今天的盤面"). */
export const outputFields = (summaryScope: string): string => `【輸出欄位】
- headline：一句標題，40 字以內。
- summary：一句話總結${summaryScope}，120 字以內。
- sections：2 到 4 段，每段有 title（24 字以內）與 body（600 字以內）。
- takeaway：收尾重點，160 字以內。
- termIds：文中用到的可用詞彙 id。`;
