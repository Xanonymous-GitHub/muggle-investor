/**
 * The one registry of wordings briefings must not use. The validators in `grounding.ts` match
 * these lists and the prompts in `prompts/shared.ts` name them, so the two cannot drift apart.
 */

export const FUTURE_WORDS = [
  "明天",
  "明日",
  "隔天",
  "隔日",
  "次日",
  "翌日",
  "下週",
  "下周",
  "下個交易日",
  "下一個交易日",
  "下一交易日",
  "未來",
  "後市",
  "後續",
  "接下來",
  "短線",
  "之後",
];

/**
 * A weekday counts as a future-time word only when directly followed by a session word
 * (週一開盤, 星期五收盤); a plain weekday ("週五是假日") does not.
 */
export const WEEKDAY_SESSION = "(?:週|周|星期)[一二三四五](?:開盤|收盤|走勢|行情)";

export const DIRECTION_WORDS = [
  "上漲",
  "下跌",
  "大漲",
  "大跌",
  "看漲",
  "看跌",
  "會漲",
  "會跌",
  "將漲",
  "將跌",
  "反彈",
  "回檔",
  "續漲",
  "續跌",
  "走高",
  "走低",
  "走強",
  "走弱",
  "走揚",
  "回升",
  "看好",
  "看淡",
  "有機會",
  "恐",
  "預期",
  "預測",
  "可望",
];

/**
 * Forecast verbs: followed by a direction word within the window they flag even without a
 * future-time word ("預料將回升").
 */
export const FORECAST_WORDS = ["預料", "預估", "預測"];

export const GUARANTEE_WORDS = ["保證", "穩賺", "必漲", "必跌", "一定會漲", "一定會跌"];

/**
 * Buying/selling advice and call-to-action wording. 投資建議 (in the fixed disclaimer
 * 「以上為資料整理與教育說明，不構成投資建議」) is not on the list; only 建議買／建議賣 are.
 */
export const ADVICE_WORDS = [
  "買進",
  "賣出",
  "加碼",
  "減碼",
  "進場",
  "出場",
  "停損",
  "停利",
  "布局",
  "建議買",
  "建議賣",
  "逢低",
  "追高",
  "抄底",
];
