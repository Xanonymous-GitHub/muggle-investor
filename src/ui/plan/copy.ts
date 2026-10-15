// DRAFT wording for the 規劃 screen, awaiting the user's review: plain-language copy for beginners
// plus the professional terms for the history labels. All of this screen's copy lives here so
// the review is a single-file diff; change the strings, not the callers. Option labels are not
// repeated here: they come from QUESTIONS, so the words the user taps are the words the scorer
// knows. No hint tells the user what to choose.
import type { Lens } from "@/insight/lens";
import { formatInt } from "@/ui/format";
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

export type SliceKey = "core" | "bond" | "dividend" | "satellite" | "cash";

export const SLICE_LABELS: Record<SliceKey, string> = {
  core: "核心：市值型 ETF",
  bond: "債券 ETF",
  dividend: "高股息 ETF",
  satellite: "衛星",
  cash: "現金",
};

export const SATELLITE_DETAIL = "沒有指定單一標的，試算時以核心標的的含息報酬代替";
export const CASH_DETAIL = "試算時不計報酬";

/** Printed before the alternate symbol of a fund slice, after the full-width space. */
export const ALTERNATE_PREFIX = "　備選 ";

/** The inputs of one rhythm sentence, in whole TWD. */
type RhythmInput = { total: number; part: number; monthly: number; months: number };

export const RHYTHM_COPY: Record<
  Lens,
  {
    tranche: (input: RhythmInput) => string;
    once: (input: { lump: number; monthly: number }) => string;
    ongoing: (monthly: number) => string;
  }
> = {
  beginner: {
    tranche: ({ total, part, monthly, months }) =>
      monthly > 0
        ? `每個月投入 ${formatInt(total)} 元（現有的錢分成 ${months} 份，每月放 ${formatInt(part)} 元，加上每月固定的 ${formatInt(monthly)} 元）`
        : `每個月投入 ${formatInt(total)} 元（現有的錢分成 ${months} 份慢慢放進去）`,
    once: ({ lump, monthly }) =>
      monthly > 0
        ? `一次投入 ${formatInt(lump)} 元，另外每個月再投入 ${formatInt(monthly)} 元`
        : `一次投入 ${formatInt(lump)} 元`,
    ongoing: (monthly) => `每個月 ${formatInt(monthly)} 元`,
  },
  pro: {
    tranche: ({ total, part, monthly, months }) =>
      monthly > 0
        ? `每月 ${formatInt(total)} 元（分批 ${formatInt(part)} + 定期 ${formatInt(monthly)}，分 ${months} 期）`
        : `每月 ${formatInt(total)} 元（分 ${months} 期）`,
    once: ({ lump, monthly }) =>
      monthly > 0
        ? `一次投入 ${formatInt(lump)}；之後每月 ${formatInt(monthly)}`
        : `一次投入 ${formatInt(lump)}`,
    ongoing: (monthly) => `每月 ${formatInt(monthly)} 元`,
  },
};

export const rhythmRange = (months: number): string => `第 1–${months} 個月`;
export const rhythmFrom = (month: number): string => `第 ${month} 個月起`;
export const RHYTHM_ONCE_WHEN = { withMonthly: "第 1 個月起", lumpOnly: "第 1 個月" } as const;

/** The about-two-tenths wording is only for a drawdown inside this band, as printed. */
export const LEVEL1_ABOUT_BAND = { min: -30, max: -15 } as const;

export const NOTICE_COPY = {
  reserveOnly: {
    title: "先把緊急預備金補齊",
    body: (gap: number, months: number | null): string =>
      months === null
        ? `預備金還差 ${formatInt(gap)} 元；目前每月投入的金額補不上這個缺口，可以調整金額再試一次。`
        : `預備金還差 ${formatInt(gap)} 元；照每月能投入的金額，大約 ${months} 個月可以補齊，之後再開始投資。`,
  },
  warningTitle: "資料提醒",
  cappedByHorizon: {
    title: "這筆錢可能很快要用",
    body: "因為這筆錢一年內可能要用，建議的配置被限制在較保守的範圍。",
  },
  insufficientHistory: {
    title: "歷史資料還不夠",
    body: "可比較的歷史資料不到一年，所以只顯示配置與投入節奏，不顯示過去表現。",
  },
  level1: {
    title: "關於債券部分",
    /** `drawdown` is the printed percent text from the response, e.g. `-22.93%`. */
    body: (drawdown: string, aboutTwoTenths: boolean): string =>
      aboutTwoTenths
        ? `這個等級的債券部分是 20 年期以上的美國公債 ETF；測試期間它仍然下跌了約兩成（最大回撤 ${drawdown}）。`
        : `這個等級的債券部分是 20 年期以上的美國公債 ETF；測試期間仍出現過 ${drawdown} 的最大回撤。`,
  },
} as const;

export type ScenarioKey = "lump" | "dca" | "plan";
export type MetricKey = "maxDrawdown" | "worstYear" | "volatility" | "xirr";

export const HISTORY_LABELS: Record<
  Lens,
  {
    scenarios: { lump: string; dca: string; plan: (trancheMonths: number) => string };
    metrics: Record<MetricKey, string>;
  }
> = {
  beginner: {
    scenarios: {
      lump: "一次投入",
      dca: "分 12 個月",
      plan: (months) => `依建議（${months} 個月）`,
    },
    metrics: {
      maxDrawdown: "最深曾經跌",
      worstYear: "最差的連續一年",
      volatility: "上下震盪幅度",
      xirr: "換算成每年",
    },
  },
  pro: {
    scenarios: {
      lump: "一次投入",
      dca: "分 12 個月",
      plan: (months) => `依建議（${months} 個月）`,
    },
    metrics: {
      maxDrawdown: "最大回撤",
      worstYear: "最差滾動十二個月",
      volatility: "年化波動度",
      xirr: "XIRR",
    },
  },
};

export function scenarioLabel(key: ScenarioKey, lens: Lens, trancheMonths: number): string {
  const { scenarios } = HISTORY_LABELS[lens];
  return key === "plan" ? scenarios.plan(trancheMonths) : scenarios[key];
}
