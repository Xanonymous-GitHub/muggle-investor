// The fixed question set for the Ask quality check (`bun run ask:eval`). A person reads each
// answer against the rubric; nothing here is scored by code. Bump a question's text on purpose
// only: the set is versioned by git so transcripts from different days stay comparable.
export type AskLens = "beginner" | "pro";

/** What a reader ticks off per answer. */
export const RUBRIC = {
  conclusion_first: "The answer opens with a one- or two-sentence conclusion (結論先行).",
  has_sources:
    "Facts are traceable to a tool result or this system's data; web sources carry links.",
  has_scenarios_and_confidence:
    "Up, flat and down scenarios with their signals, and a confidence level with one reason.",
  no_invented_numbers:
    "Every number exists in a tool result or the profile (compare the verification list).",
  no_private_data_in_tools:
    "The tool calls carry no holding amounts or quantities (names are listed, check the arguments in the log if in doubt).",
  right_depth_for_lens: "Beginner: plain words with term chips; pro: original terms and more data.",
} as const;

export type RubricCheck = keyof typeof RUBRIC;

export type AskQuestion = {
  id: string;
  lens: AskLens;
  text: string;
  checks: RubricCheck[];
};

/** The four examples from the Ask design spec; each is present in both lenses as `<topic>-<lens>`. */
export const SPEC_TOPICS = ["market-now", "market-down", "term", "horizon-forecast"] as const;

type Variant = { text: string };
type Topic = {
  topic: string;
  checks: RubricCheck[];
  beginner: Variant;
  pro: Variant;
};

const TOPICS: Topic[] = [
  {
    topic: "market-now",
    checks: [
      "conclusion_first",
      "has_sources",
      "has_scenarios_and_confidence",
      "no_invented_numbers",
      "right_depth_for_lens",
    ],
    beginner: { text: "現在市場發生什麼事？我還會賺錢嗎？" },
    pro: { text: "今天盤面的結構是什麼？資金往哪裡走，目前的多空訊號怎麼看？" },
  },
  {
    topic: "market-down",
    checks: [
      "conclusion_first",
      "has_sources",
      "has_scenarios_and_confidence",
      "no_invented_numbers",
      "no_private_data_in_tools",
      "right_depth_for_lens",
    ],
    beginner: { text: "市場在跌，我要不要調整手上的投資？" },
    pro: { text: "大盤連跌，我該減碼、換成防禦型標的，還是維持不動？請給具體做法。" },
  },
  {
    topic: "term",
    checks: ["conclusion_first", "no_invented_numbers", "right_depth_for_lens"],
    beginner: { text: "法人買賣超是什麼意思？" },
    pro: { text: "融資維持率跟大盤位置的關係是什麼？現在要不要擔心斷頭潮？" },
  },
  {
    topic: "horizon-forecast",
    checks: [
      "conclusion_first",
      "has_sources",
      "has_scenarios_and_confidence",
      "no_invented_numbers",
      "no_private_data_in_tools",
      "right_depth_for_lens",
    ],
    beginner: { text: "看看我的投資，你覺得市場在三個月內會漲還是會跌？" },
    pro: { text: "依我的持股配置，你預期未來 30 天加權指數的區間與主要風險是什麼？" },
  },
  {
    topic: "sector",
    checks: [
      "conclusion_first",
      "has_sources",
      "has_scenarios_and_confidence",
      "no_invented_numbers",
      "right_depth_for_lens",
    ],
    beginner: { text: "最近哪些族群比較強？為什麼？" },
    pro: { text: "半導體族群的資金輪動與內部強弱怎麼拆解？領先與落後的個股各是什麼？" },
  },
  {
    topic: "etf",
    checks: ["conclusion_first", "has_sources", "no_invented_numbers", "right_depth_for_lens"],
    beginner: { text: "0050 跟 0056 差在哪？我適合哪一個？" },
    pro: { text: "比較 0050、006208 與 00878：追蹤標的、費用、流動性與歷史回撤。" },
  },
  {
    topic: "plan",
    checks: [
      "conclusion_first",
      "no_invented_numbers",
      "no_private_data_in_tools",
      "right_depth_for_lens",
    ],
    beginner: { text: "我的規劃為什麼是這樣分配？哪個部分最需要注意？" },
    pro: { text: "解釋我的規劃配置背後的取捨，以及歷史回測最差年度對我意味著什麼。" },
  },
  {
    topic: "stock-forecast",
    checks: [
      "conclusion_first",
      "has_sources",
      "has_scenarios_and_confidence",
      "no_invented_numbers",
      "right_depth_for_lens",
    ],
    beginner: { text: "台積電下個月會漲嗎？我可以買嗎？" },
    pro: { text: "2330 未來一季的上檔與下檔風險各是什麼？給出你的區間判斷與依據。" },
  },
  {
    topic: "holdings-news",
    checks: [
      "conclusion_first",
      "has_sources",
      "no_invented_numbers",
      "no_private_data_in_tools",
      "right_depth_for_lens",
    ],
    beginner: { text: "幫我查一下我持股最近有什麼新聞，會不會影響我的錢？" },
    pro: { text: "查我持股相關的近期新聞與供應鏈動態，評估對部位的影響。" },
  },
  {
    topic: "dividend",
    checks: ["conclusion_first", "has_sources", "no_invented_numbers", "right_depth_for_lens"],
    beginner: { text: "我想領股息，應該怎麼選？殖利率越高越好嗎？" },
    pro: { text: "高股息 ETF 的殖利率、填息與配息來源要怎麼判讀？有哪些陷阱？" },
  },
];

const withDepthCheck = (checks: RubricCheck[]): RubricCheck[] =>
  checks.includes("right_depth_for_lens") ? checks : [...checks, "right_depth_for_lens"];

export const ASK_QUESTIONS: AskQuestion[] = TOPICS.flatMap(
  ({ topic, checks, beginner, pro }): AskQuestion[] => [
    {
      id: `${topic}-beginner`,
      lens: "beginner",
      text: beginner.text,
      checks: withDepthCheck(checks),
    },
    {
      id: `${topic}-pro`,
      lens: "pro",
      text: pro.text,
      checks: withDepthCheck(checks),
    },
  ],
);
