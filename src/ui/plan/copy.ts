// DRAFT beginner wording for the 規劃 screen, awaiting the user's review. All of this screen's
// plain-language copy lives here so the review is a single-file diff; change the strings, not
// the callers. Option labels are not repeated here: they come from QUESTIONS, so the words the
// user taps are the words the scorer knows. No hint tells the user what to choose.
import type { AmountError, AmountField, QuestionId } from "@/ui/plan/draft";
import { DISCLAIMER } from "@/ui/today/view-model";

export const QUESTION_COPY: Record<QuestionId, { prompt: string; hint: string | null }> = {
  age: { prompt: "你現在幾歲？", hint: null },
  horizon: { prompt: "這筆錢多久後可能要用？", hint: "例如買房頭期款、子女教育費。" },
  income: { prompt: "你的收入穩定嗎？", hint: null },
  reserve: {
    prompt: "手上有幾個月的生活費可以隨時動用？",
    hint: "指放在銀行、隨時能領出來的錢。",
  },
  loss: {
    prompt: "如果一年內帳面虧損 20%，你會怎麼做？",
    hint: "帳面虧損是還沒賣出前的暫時損失。",
  },
};

// The unit 元 is added by the field component, so labels and hints stay unit-free.
export const AMOUNT_COPY: Record<AmountField, { label: string; hint: string | null }> = {
  lump: { label: "現在可以投入的錢", hint: "一次拿得出來、短期內不會用到的金額。沒有就填 0。" },
  monthly: { label: "每月還能再投入", hint: "每個月扣掉開銷後，固定能多出來的金額。沒有就填 0。" },
  monthlyExpenses: { label: "每月的生活費", hint: "房租、吃飯、交通等每月一定要花的錢。" },
  existingReserve: {
    label: "已經有的緊急預備金",
    hint: "遇到突發狀況可以馬上動用的現金。沒有就填 0。",
  },
};

export const AMOUNT_ERROR_COPY: Record<AmountError, string> = {
  empty: "請填一個金額，沒有就填 0。",
  not_integer: "請只填整數數字，不要有小數點、負號或文字。",
  too_large: "金額太大了，請填 10 億以內的數字。",
  zero: "「現在可以投入的錢」和「每月還能再投入」不能同時是 0。",
};

/** Shown under a question the user skipped, on the single-page form, after a submit attempt. */
export const ANSWER_MISSING = "請選一個答案。";

/** The unit printed beside every amount field. */
export const AMOUNT_UNIT = "元";

export const FORM_COPY = {
  questionsTitle: "你的情況",
  amountsTitle: "金額",
  back: "上一步",
  next: "下一步",
  submit: "看我的規劃",
  editAnswers: "修改答案",
} as const;

export const stepLabel = (step: number, total: number): string => `第 ${step} 步，共 ${total} 步`;

export const PRIVACY_LINE = "答案只留在這台裝置；算的時候會暫時傳到伺服器，不會被儲存。";

/** Printed on every result, in this order. */
export const FIXED_SENTENCES = ["過去表現不代表未來。", DISCLAIMER] as const;
