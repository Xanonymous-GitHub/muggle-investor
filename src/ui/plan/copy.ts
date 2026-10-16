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

/** The profile card: the level, its five-segment meter and how the level was reached. */
export const PROFILE_COPY = {
  heading: "風險等級",
  levelLabel: (level: number, name: string): string => `${level} ${name}`,
  meterLabel: (level: number): string => `風險等級 ${level}，共 5 級`,
  explain: {
    beginner: ({ capacity, willingness, level }: ProfileInput): string =>
      `你的處境能承受的風險是 ${capacity}，你自己面對虧損的感覺是 ${willingness}。兩者取比較小的，所以是 ${level}。`,
    pro: ({ capacity, willingness }: ProfileInput): string =>
      `承受能力 ${capacity}（第 1–4 題平均），承受意願 ${willingness}（第 5 題），取較小者。`,
  },
} as const;

type ProfileInput = { capacity: number; willingness: number; level: string };

/** The reserve card; the status line follows its 緊急預備金 heading. `gap` is the full shortfall, `remaining` what is left after this time's lump. */
export const RESERVE_COPY = {
  label: "緊急預備金",
  status: ({
    target,
    gap,
    remaining,
  }: {
    target: number;
    gap: number;
    remaining: number;
  }): string => {
    const head = `${formatInt(target)} 元`;
    if (gap === 0) return `${head}　已備齊`;
    return remaining === 0 ? `${head}　這次就能補滿` : `${head}　還差 ${formatInt(remaining)} 元`;
  },
  /** Only when this time's lump closes the gap: the rest of the money is then invested. */
  filled: ({ have, deposit }: { have: number; deposit: number }): string =>
    `目前有 ${formatInt(have)} 元，這次先放進 ${formatInt(deposit)} 元補滿，剩下的錢才拿去投資。`,
} as const;

export const ALLOCATION_COPY = {
  title: (investable: number): string => `${formatInt(investable)} 元怎麼分`,
  barLabel: (parts: { label: string; percent: number }[]): string =>
    `配置比例：${parts.map((p) => `${p.label} ${p.percent}%`).join("、")}`,
  amount: (amount: number): string => `${formatInt(amount)} 元`,
  footnote: {
    beginner: "試算時每年一次，把各份調回上面的比例。",
    pro: "試算含每年一次再平衡，回到目標權重。",
  },
} as const;

export const RHYTHM_HEADING = "投入節奏";
export const ASSUMPTIONS_HEADING = "試算前提";

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

/**
 * The inputs of one rhythm sentence, in whole TWD. `part` is the lump's equal share per month
 * (rounded down, like the engine), `extra` the remainder that goes into month 1 on top of it.
 */
type RhythmInput = { part: number; extra: number; monthly: number; months: number };

export const RHYTHM_COPY: Record<
  Lens,
  {
    tranche: (input: RhythmInput) => string;
    once: (input: { lump: number; monthly: number }) => string;
    ongoing: (monthly: number) => string;
  }
> = {
  beginner: {
    tranche: ({ part, extra, monthly, months }) => {
      const base =
        monthly > 0
          ? `每個月投入 ${formatInt(part + monthly)} 元（現有的錢分成 ${months} 份，每月放 ${formatInt(part)} 元，再加上每月固定的 ${formatInt(monthly)} 元）`
          : `每個月投入 ${formatInt(part)} 元（現有的錢分成 ${months} 份慢慢放進去）`;
      return extra > 0
        ? `${base}；除不盡的 ${formatInt(extra)} 元放在第 1 個月，第 1 個月共 ${formatInt(part + extra + monthly)} 元`
        : base;
    },
    once: ({ lump, monthly }) =>
      monthly > 0
        ? `一次投入 ${formatInt(lump)} 元，另外每個月再投入 ${formatInt(monthly)} 元`
        : `一次投入 ${formatInt(lump)} 元`,
    ongoing: (monthly) => `每個月 ${formatInt(monthly)} 元`,
  },
  pro: {
    tranche: ({ part, extra, monthly, months }) => {
      const base =
        monthly > 0
          ? `每月 ${formatInt(part + monthly)} 元（分批 ${formatInt(part)} + 定期 ${formatInt(monthly)}，分 ${months} 期）`
          : `每月 ${formatInt(part)} 元（分 ${months} 期）`;
      return extra > 0
        ? `${base}；餘數 ${formatInt(extra)} 元併入第 1 個月，第 1 個月共 ${formatInt(part + extra + monthly)} 元`
        : base;
    },
    once: ({ lump, monthly }) =>
      monthly > 0
        ? `一次投入 ${formatInt(lump)}；接著每月 ${formatInt(monthly)}`
        : `一次投入 ${formatInt(lump)}`,
    ongoing: (monthly) => `每月 ${formatInt(monthly)} 元`,
  },
};

export const rhythmRange = (months: number): string => `第 1–${months} 個月`;
export const rhythmFrom = (month: number): string => `第 ${month} 個月起`;
export const RHYTHM_ONCE_WHEN = { withMonthly: "第 1 個月起", lumpOnly: "第 1 個月" } as const;

/** The inputs of the reserve-only sentence, in whole TWD. */
type ReserveInput = {
  target: number;
  have: number;
  /** What this time's lump puts into the reserve. */
  deposit: number;
  remaining: number;
  /** Months of the monthly amount that fill the remainder; null without a monthly amount. */
  months: number | null;
};

export const NOTICE_COPY = {
  reserveOnly: {
    title: "先把緊急預備金補齊",
    body: ({ target, have, deposit, remaining, months }: ReserveInput): string => {
      const state = `緊急預備金目標 ${formatInt(target)} 元，目前有 ${formatInt(have)} 元`;
      if (remaining === 0) return `${state}，這次投入 ${formatInt(deposit)} 元，這次就能補滿。`;
      const put = deposit > 0 ? `，這次放進 ${formatInt(deposit)} 元` : "";
      const left = `，還差 ${formatInt(remaining)} 元`;
      return months === null
        ? `${state}${put}${left}；目前沒有每月投入的金額，所以補不上這個缺口。`
        : `${state}${put}${left}；照每月投入的金額，再 ${months} 個月可以補齊，補齊後才開始投資。`;
    },
  },
  warningTitle: "資料提醒",
  cappedByHorizon: {
    title: "這筆錢可能不用等太久",
    body: "這筆錢可能在幾年內要用，所以配置被限制在比較保守的範圍。",
  },
  insufficientHistory: {
    title: "歷史資料還不夠",
    body: "可比較的歷史資料不到一年，所以只顯示配置與投入節奏，不顯示過去表現。",
  },
  level1: {
    title: "關於債券部分",
    /** `drop` is the unsigned percent of the whole mix's worst fall, e.g. `22.93%`. */
    body: (
      lens: Lens,
      input: { percent: number; name: string; symbol: string; drop: string; signed: string },
    ): string => {
      const base = `這個等級有 ${input.percent}% 放在債券 ETF（${input.name}，${input.symbol}），是 20 年期以上的美國公債。整體配置在測試期間最深曾從高點下跌 ${input.drop}`;
      return lens === "pro" ? `${base}（最大回撤 ${input.signed}）。` : `${base}。`;
    },
  },
} as const;

export type ScenarioKey = "lump" | "dca" | "plan";
export type MetricKey = "maxDrawdown" | "worstYear" | "volatility" | "xirr";

const planLabel = (months: number): string =>
  months === 1 ? "依建議（一次投入）" : `依建議（${months} 個月）`;

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
      plan: planLabel,
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
      plan: planLabel,
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

/** The history card. Every window sentence is printed with the numbers it belongs to. */
export const HISTORY_COPY = {
  heading: { beginner: "過去這樣做會怎樣", pro: "歷史試算" } satisfies Record<Lens, string>,
  tabs: { main: "建議配置", equity: "只有股票" },
  window: ({ from, to, years }: { from: string; to: string; years: number }): string =>
    `${from} 至 ${to}，共 ${years} 年`,
  /** After the main window, only when the plan holds a bond slice. */
  bondLimit: "受債券 ETF 的上市時間限制",
  /** After the equity-only window: the run holds the dividend ETF only when the plan has one. */
  equityOnly: {
    withDividend: "只有核心與高股息，沒有債券和現金",
    coreOnly: "只有核心，沒有債券和現金",
  },
  /** The table's caption (visually hidden), naming the window its numbers belong to. */
  tableCaption: (windowLine: string): string => `三種投入方式比較，${windowLine}`,
  scenarioHeader: "投入方式",
  investedHeader: "投入總額（元）",
  finalHeader: "期末市值（元）",
  /** Beside a `—` for an xirr or worst year the response leaves null. */
  tooShort: "期間太短，無法計算",
  sameMoney: "三種方式放進去的總錢數一樣，只差在放的時間。",
  /** The chart's dotted line; the other three lines use the scenario labels. */
  investedLine: { beginner: "累計投入的錢", pro: "累計投入" } satisfies Record<Lens, string>,
  chartUnit: "單位：百萬元",
  tooltipAmount: (amount: string): string => `${amount} 元`,
} as const;

/** The chart's window sentence with its note, e.g. `2017-01-17 至 2026-10-14，共 9.7 年（…）`. */
export const historyWindowLine = (
  window: { from: string; to: string; years: number },
  note: string | null,
): string =>
  note === null ? HISTORY_COPY.window(window) : `${HISTORY_COPY.window(window)}（${note}）`;

/** The AI explanation card. It never repeats the reader's own amounts. */
export const EXPLANATION_COPY = {
  /** `2026-W42` reads 整理於 2026 年第 42 週; a key of another shape is printed as it is. */
  dated: (periodKey: string): string => {
    const week = /^(\d{4})-W(\d{1,2})$/.exec(periodKey);
    return week ? `整理於 ${week[1]} 年第 ${Number(week[2])} 週` : `整理於 ${periodKey}`;
  },
  aiNote: "說明由 AI 整理，數字來自歷史試算。",
  missing: "說明還在準備中",
  failed: "說明暫時讀不到",
  reload: "重新載入",
  loading: "說明載入中",
} as const;

/** What replaces the result while it loads or when it cannot be shown. */
export const RESULT_COPY = {
  loading: "載入中",
  historyLoading: "歷史載入中",
  historyFailed: "歷史暫時讀不到",
  errors: {
    invalid: { message: "答案有誤，請修改後再試", retry: null },
    unavailable: { message: "最新的價格資料還沒準備好", retry: "再試一次" },
    failed: { message: "暫時算不出來", retry: "再試一次" },
    offline: { message: "需要連線才能試算", retry: "再試一次" },
  },
  savedNote: "你的答案都還在。",
} as const;
