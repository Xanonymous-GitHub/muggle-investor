import type { GlossaryTerm } from "./schema";

/**
 * The shared vocabulary. `darkfanxing` entries copy the report's 詞彙表 definition verbatim;
 * `curated` entries are written here. Education only — never advice or predictions.
 */
export const GLOSSARY: readonly GlossaryTerm[] = [
  // ── darkfanxing-sourced ──────────────────────────────────────────────
  {
    id: "sector",
    term: "族群",
    aliases: ["細產業", "產業族群"],
    category: "market",
    beginner: {
      plain: "做同一類生意的一群公司，例如半導體、航運，放在一起看漲跌。",
      analogy: "像學校依社團分組，看今天哪個社團整體表現比較好。",
      whyItMatters: "看族群而不是單一股票，比較容易看出資金今天往哪些產業移動。",
    },
    pro: {
      definition: "XQ 細產業指標的分類；族群漲跌幅＝成分股今日漲跌幅的等權平均。",
      formula: null,
      source: "darkfanxing",
    },
    related: ["sector-breadth", "equal-weight-average", "change-pct"],
  },
  {
    id: "sector-breadth",
    term: "上漲／下跌族群數",
    aliases: ["上漲/下跌族群數", "上漲族群數", "下跌族群數", "漲跌族群數"],
    category: "market",
    beginner: {
      plain: "今天上漲的族群有幾個、下跌的族群有幾個。",
      analogy: "像統計全班有幾個人及格、幾個人不及格。",
      whyItMatters: "能看出今天是多數產業一起漲跌，還是只有少數產業在動。",
    },
    pro: {
      definition: "今日漲跌幅為正／為負的族群個數。",
      formula: null,
      source: "darkfanxing",
    },
    related: ["sector", "area"],
  },
  {
    id: "force",
    term: "力度",
    aliases: [],
    category: "market",
    beginner: {
      plain: "把所有族群的漲跌合起來看，但規模大的族群分量比較重，代表大公司今天的方向和強弱。",
      analogy: "大公司說了算：規模越大的族群，說話越大聲。",
      whyItMatters: "台股指數受大型權值股影響很大，力度幫你看出這些大公司今天往哪邊走。",
    },
    pro: {
      definition:
        "全部族群今日漲跌幅依 √市值 加權的均方根再帶正負號（%）；反映權值族群的方向與強度，±2% 內視為拉鋸。",
      formula: null,
      source: "darkfanxing",
    },
    related: ["area", "sector"],
  },
  {
    id: "area",
    term: "面積",
    aliases: [],
    category: "market",
    beginner: {
      plain: "不管公司大小，每個族群都算一份，看大家今天普遍是漲還是跌。",
      analogy: "人人一票：每個族群一樣重要，比較能反映中小型股的氣氛。",
      whyItMatters:
        "指數上漲不代表多數股票都漲；面積和力度方向不同時，表示大公司和中小型股走勢分歧。",
    },
    pro: {
      definition:
        "全部族群今日漲跌幅的等權典型值（%）；反映中小型族群的普遍方向。力度與面積方向不同＝權值與中小型分歧。",
      formula: null,
      source: "darkfanxing",
    },
    related: ["force", "equal-weight-average", "sector-breadth"],
  },
  {
    id: "net-active-buy",
    term: "內外盤金額差",
    aliases: ["內外盤差", "外盤減內盤", "主動買賣差", "主動買賣", "淨主動買"],
    category: "flow",
    beginner: {
      plain: "急著買的人花的錢，減去急著賣的人賣掉的錢；正數代表主動買的一方比較積極。",
      analogy: "像市場裡直接照老闆開價買的客人，和直接照客人出價就賣的老闆，誰的成交金額比較多。",
      whyItMatters: "能看出當天是買方還是賣方比較積極；它只描述當天，不能用來推測明天的漲跌。",
    },
    pro: {
      definition:
        "成分股當日「成交在委賣價（主動買、外盤）」的金額 − 「成交在委買價（主動賣、內盤）」的金額，單位億元；正＝淨主動買。",
      formula: null,
      source: "darkfanxing",
    },
    related: ["capital-flow-slope", "concentration-ratio", "turnover"],
  },
  {
    id: "concentration-ratio",
    term: "集中倍數",
    aliases: ["資金集中倍數"],
    category: "flow",
    beginner: {
      plain: "這個族群最近分到的成交金額比重，是它平常的幾倍；大於 1 代表比平常更熱門。",
      analogy: "像一家店平常占整條街一成的客人，最近占了兩成，就是平常的 2 倍。",
      whyItMatters: "能看出最近資金特別集中在哪些族群。",
    },
    pro: {
      definition:
        "該族群近期成交金額占全市場比重 ÷ 它當日的平均占比；>1 表示資金比平常更集中在這個族群。",
      formula: null,
      source: "darkfanxing",
    },
    related: ["turnover", "net-active-buy", "sector"],
  },
  {
    id: "capital-flow-slope",
    term: "近 N 日斜率",
    aliases: [
      "近N日斜率",
      "近 5 日斜率",
      "近5日斜率",
      "近 20 日斜率",
      "近20日斜率",
      "5 日斜率",
      "5日斜率",
      "20 日斜率",
      "20日斜率",
    ],
    category: "flow",
    beginner: {
      plain: "最近幾天，資金平均每天是流進還是流出這個族群；正數是流進，負數是流出。",
      analogy: "像看存摺最近幾週的餘額，整體是往上還是往下走。",
      whyItMatters: "比只看單一天更能看出資金流動的趨勢；短期（5 日）和長期（20 日）可以互相對照。",
    },
    pro: {
      definition:
        "族群近 N 個交易日每日內外盤金額差的累計序列對天數做迴歸的斜率（億/日），＝平均每日淨流入的趨勢。",
      formula: null,
      source: "darkfanxing",
    },
    related: ["net-active-buy", "flow-quadrant"],
  },
  {
    id: "flow-quadrant",
    term: "四象限",
    aliases: ["資金四象限", "資金象限"],
    category: "flow",
    beginner: {
      plain: "用短期（5 日）和長期（20 日）的資金趨勢，把族群分成強勢、弱勢、轉強、轉弱四類。",
      analogy: "像用「最近一週」和「最近一個月」的出席紀錄，把同學分成四組。",
      whyItMatters: "一眼看出哪些族群資金持續進來、哪些持續離開、哪些最近改變了方向。",
    },
    pro: {
      definition:
        "X＝近 5 日斜率、Y＝近 20 日斜率。強勢＝兩者皆正；弱勢＝兩者皆負；轉強＝長線仍負但短線翻正；轉弱＝長線仍正但短線翻負。",
      formula: null,
      source: "darkfanxing",
    },
    related: [
      "capital-flow-slope",
      "quadrant-strong",
      "quadrant-weak",
      "quadrant-turning-strong",
      "quadrant-turning-weak",
    ],
  },
  {
    id: "limit-locked",
    term: "漲停鎖死",
    aliases: ["鎖漲停", "漲停鎖住"],
    category: "limit",
    beginner: {
      plain: "股價停在當天最高能漲到的價格，而且沒有人掛單要賣，想買的人排隊也買不到。",
      analogy: "像熱門演唱會門票已經賣完，門口還有一長串人在排隊。",
      whyItMatters: "代表當天買的人遠多於賣的人；但鎖死只描述當天，不保證之後還會漲。",
    },
    pro: {
      definition:
        "成交價在漲停且委賣第一檔為 0（沒有人要賣）。首鎖＝當天第一次鎖死的時間；打開次數＝鎖死後又出現賣單的次數。",
      formula: null,
      source: "darkfanxing",
    },
    related: ["limit-up", "limit-down"],
  },

  // ── curated: market ──────────────────────────────────────────────────
  {
    id: "taiex-futures",
    term: "台指期",
    aliases: ["臺指期", "台指期貨", "臺指期貨", "台股期貨", "臺股期貨"],
    category: "market",
    beginner: {
      plain: "以台股大盤指數為標的的期貨合約，交易時間比股市長，收盤後還能交易。",
      analogy: null,
      whyItMatters: "股市收盤後台指期仍在交易，常被拿來觀察市場對大盤的即時看法。",
    },
    pro: {
      definition:
        "以臺灣證券交易所發行量加權股價指數為標的、在臺灣期貨交易所掛牌交易的股價指數期貨契約。",
      formula: null,
      source: "curated",
    },
    related: ["turnover"],
  },
  {
    id: "turnover",
    term: "成交金額",
    aliases: ["成交值", "成交額"],
    category: "market",
    beginner: {
      plain: "一段時間內所有成交的交易加起來，總共換手了多少錢。",
      analogy: "像一家店今天的營業額。",
      whyItMatters: "成交金額大代表交易熱絡、參與的人多；只看漲跌不看成交金額容易誤判熱度。",
    },
    pro: {
      definition: "一段期間內每筆成交的成交價乘以成交股數之總和，台股市場統計常以億元為單位。",
      formula: "成交金額 = Σ（成交價 × 成交股數）",
      source: "curated",
    },
    related: ["concentration-ratio", "net-active-buy"],
  },
  {
    id: "change-pct",
    term: "漲跌幅",
    aliases: ["漲跌百分比", "漲幅", "跌幅"],
    category: "market",
    beginner: {
      plain: "現在的價格和參考價（通常是前一個交易日的收盤價）相比，漲或跌了百分之幾。",
      analogy: null,
      whyItMatters: "用百分比比較，價格高低不同的股票才能放在一起比。",
    },
    pro: {
      definition: "價格相對參考價（通常為前一交易日收盤價）的變動百分比。",
      formula: "漲跌幅 =（現價 − 參考價）÷ 參考價 × 100%",
      source: "curated",
    },
    related: ["one-month-change", "limit-up", "limit-down"],
  },
  {
    id: "one-month-change",
    term: "近 1 月漲幅",
    aliases: ["近1月漲幅", "近一月漲幅", "近一個月漲幅", "近 1 個月漲幅"],
    category: "market",
    beginner: {
      plain: "和大約一個月前相比，價格漲或跌了百分之幾。",
      analogy: null,
      whyItMatters: "比只看一天更能看出最近一段時間的走勢。",
    },
    pro: {
      definition: "價格相對約一個月前收盤價的變動百分比，負值表示下跌。",
      formula: "近 1 月漲幅 =（今日收盤價 − 約一個月前收盤價）÷ 約一個月前收盤價 × 100%",
      source: "curated",
    },
    related: ["change-pct"],
  },
  {
    id: "equal-weight-average",
    term: "等權平均",
    aliases: ["等權重平均", "簡單平均"],
    category: "market",
    beginner: {
      plain: "每個成員不管規模大小都算一份，加總後再平均。",
      analogy: "像全班平均分數，每位同學的分數都一樣重要。",
      whyItMatters: "可以避免少數大公司主導結果，看到多數成員的普遍表現。",
    },
    pro: {
      definition: "對每個成分給予相同權重所計算的算術平均數。",
      formula: "等權平均 =（x₁ + x₂ + … + xₙ）÷ n",
      source: "curated",
    },
    related: ["sector", "area"],
  },
  {
    id: "etf",
    term: "ETF",
    aliases: ["指數股票型基金", "交易所交易基金"],
    category: "market",
    beginner: {
      plain: "把一籃子股票包成一檔基金，可以在股市像買賣股票一樣交易。",
      analogy: "像水果禮盒，一次就買到多種水果，不用一顆一顆挑。",
      whyItMatters: "買一檔就能分散到很多公司，不必把錢全押在單一公司上。",
    },
    pro: {
      definition:
        "Exchange-Traded Fund，在證券交易所上市、可於交易時間內像股票一樣買賣的基金，多數以追蹤特定指數表現為目標。",
      formula: null,
      source: "curated",
    },
    related: ["dca", "lump-sum"],
  },

  // ── curated: flow quadrants ──────────────────────────────────────────
  {
    id: "quadrant-strong",
    term: "強勢",
    aliases: ["強勢象限"],
    category: "flow",
    beginner: {
      plain: "短期（5 日）和長期（20 日）資金都在流進的族群。",
      analogy: null,
      whyItMatters: "表示這段期間資金持續偏好這個族群；這是描述過去，不代表之後一定續漲。",
    },
    pro: {
      definition: "四象限分類中，近 5 日斜率與近 20 日斜率皆為正的族群。",
      formula: null,
      source: "curated",
    },
    related: ["flow-quadrant", "capital-flow-slope", "quadrant-turning-weak"],
  },
  {
    id: "quadrant-weak",
    term: "弱勢",
    aliases: ["弱勢象限"],
    category: "flow",
    beginner: {
      plain: "短期（5 日）和長期（20 日）資金都在流出的族群。",
      analogy: null,
      whyItMatters: "表示這段期間資金持續離開這個族群；這是描述過去，不代表之後一定續跌。",
    },
    pro: {
      definition: "四象限分類中，近 5 日斜率與近 20 日斜率皆為負的族群。",
      formula: null,
      source: "curated",
    },
    related: ["flow-quadrant", "capital-flow-slope", "quadrant-turning-strong"],
  },
  {
    id: "quadrant-turning-strong",
    term: "轉強",
    aliases: ["轉強象限"],
    category: "flow",
    beginner: {
      plain: "長期（20 日）資金仍在流出，但最近（5 日）開始流進的族群。",
      analogy: null,
      whyItMatters: "顯示最近資金態度出現變化；這是描述已發生的事，不代表會一直延續。",
    },
    pro: {
      definition: "四象限分類中，近 20 日斜率為負、近 5 日斜率為正的族群。",
      formula: null,
      source: "curated",
    },
    related: ["flow-quadrant", "capital-flow-slope", "quadrant-weak"],
  },
  {
    id: "quadrant-turning-weak",
    term: "轉弱",
    aliases: ["轉弱象限"],
    category: "flow",
    beginner: {
      plain: "長期（20 日）資金仍在流進，但最近（5 日）開始流出的族群。",
      analogy: null,
      whyItMatters: "顯示最近資金態度出現變化；這是描述已發生的事，不代表會一直延續。",
    },
    pro: {
      definition: "四象限分類中，近 20 日斜率為正、近 5 日斜率為負的族群。",
      formula: null,
      source: "curated",
    },
    related: ["flow-quadrant", "capital-flow-slope", "quadrant-strong"],
  },

  // ── curated: price limits ────────────────────────────────────────────
  {
    id: "limit-up",
    term: "漲停",
    aliases: ["漲停板", "漲停價"],
    category: "limit",
    beginner: {
      plain: "股價漲到當天規定的最高價格；多數上市櫃股票一天最多只能漲 10%。",
      analogy: "像道路速限，當天價格到頂就不能再往上。",
      whyItMatters: "看到漲停就知道當天想買的人非常多；但當天到頂，不代表隔天也會漲。",
    },
    pro: {
      definition:
        "當日漲幅達到限制上限時的價格；台股上市櫃股票的漲跌幅限制為參考價的 10%，新股上市初期等情形另有規定。",
      formula: null,
      source: "curated",
    },
    related: ["limit-down", "limit-locked", "change-pct"],
  },
  {
    id: "limit-down",
    term: "跌停",
    aliases: ["跌停板", "跌停價"],
    category: "limit",
    beginner: {
      plain: "股價跌到當天規定的最低價格；多數上市櫃股票一天最多只能跌 10%。",
      analogy: "像電梯最低只到地下一樓，當天價格到底就不能再往下。",
      whyItMatters: "看到跌停就知道當天想賣的人非常多；但當天到底，不代表隔天也會跌。",
    },
    pro: {
      definition:
        "當日跌幅達到限制下限時的價格；台股上市櫃股票的漲跌幅限制為參考價的 10%，新股上市初期等情形另有規定。",
      formula: null,
      source: "curated",
    },
    related: ["limit-up", "change-pct"],
  },

  // ── curated: planning ────────────────────────────────────────────────
  {
    id: "dca",
    term: "定期定額",
    aliases: ["定期定額投資", "定期定額買進", "DCA"],
    category: "planning",
    beginner: {
      plain: "每隔固定時間（例如每月）投入固定金額買進，不管當時價格高低。",
      analogy: "像每月固定存一筆錢；價格低時，同樣的錢能買到比較多單位。",
      whyItMatters: "不需要自己判斷進場時機，是許多人入門時接觸的累積方式；但它不保證獲利。",
    },
    pro: {
      definition: "以固定時間間隔投入固定金額買進同一標的的投資方式，價格低時買進的單位數較多。",
      formula: null,
      source: "curated",
    },
    related: ["lump-sum", "etf", "cagr"],
  },
  {
    id: "lump-sum",
    term: "單筆投入",
    aliases: ["單筆投資", "單筆買進", "單筆", "一次投入"],
    category: "planning",
    beginner: {
      plain: "把準備好的一整筆錢，一次全部買進。",
      analogy: null,
      whyItMatters: "和定期定額相比，結果受買進那一天的價格影響比較大。",
    },
    pro: {
      definition: "將可投資資金於單一時點全數買進標的的投資方式，與分批投入的定期定額相對。",
      formula: null,
      source: "curated",
    },
    related: ["dca", "cagr", "max-drawdown"],
  },
  {
    id: "cagr",
    term: "年化報酬率",
    aliases: ["年化報酬", "年複合成長率", "複合年成長率", "年均複合報酬率", "CAGR"],
    category: "planning",
    beginner: {
      plain: "把好幾年的總報酬，用複利換算成「平均每年賺或賠了百分之幾」。",
      analogy: "像把一趟長途旅程換算成平均時速，不同路程才能互相比較。",
      whyItMatters: "投資期間長短不同時，用年化報酬率比較才公平。",
    },
    pro: {
      definition: "以複利計算、使期初價值成長至期末價值所對應的固定年報酬率。",
      formula: "CAGR =（期末價值 ÷ 期初價值）^(1 ÷ 年數) − 1",
      source: "curated",
    },
    related: ["max-drawdown", "volatility", "dca", "lump-sum"],
  },
  {
    id: "max-drawdown",
    term: "最大回撤",
    aliases: ["最大跌幅", "最大拉回", "MDD"],
    category: "planning",
    beginner: {
      plain: "一段期間裡，從某個最高點往下跌到之後最低點，最慘的那一次跌了百分之幾。",
      analogy: "像回頭看這一年裡帳戶最難看的那一天，比當時的最高點少了多少。",
      whyItMatters: "讓你事先想像最糟的時候帳面可能縮水多少，判斷自己撐不撐得住。",
    },
    pro: {
      definition: "一段期間內，資產價值從先前高點跌至其後低點的最大跌幅百分比。",
      formula: "MDD = max_t［（截至 t 的最高價值 − t 時價值）÷ 截至 t 的最高價值］",
      source: "curated",
    },
    related: ["volatility", "cagr"],
  },
  {
    id: "volatility",
    term: "波動度",
    aliases: ["波動率", "波動性"],
    category: "planning",
    beginner: {
      plain: "價格上上下下晃動得有多厲害；數字越大，起伏越劇烈。",
      analogy: "像搭車時路面顛簸的程度，路況越差晃得越兇。",
      whyItMatters: "波動大代表短期內帳面可能大起大落，心理壓力也比較大。",
    },
    pro: {
      definition:
        "報酬率的標準差，衡量價格變動的劇烈程度；年化時以日報酬率標準差乘以一年交易日數的平方根。",
      formula: "年化波動度 = 日報酬率標準差 × √N（N＝一年交易日數）",
      source: "curated",
    },
    related: ["max-drawdown", "cagr"],
  },
];
