// Typed /api/plan responses for tests. The numbers come from a real run (9.7 years of 0050,
// 00679B and 0056; the equity-only run from 2007-12-26); each series is trimmed to eight
// month-end points, first and last included, so the last value is still `finalValue`.
import { GLOSSARY } from "@/glossary";
import type { PlanExplanationJson, PlanJson } from "@/ui/data/api";
import type { PlanOk } from "@/ui/plan/view-model";

type Scenarios = PlanOk["scenarios"];
type Reserve = Extract<PlanJson, { kind: "reserve_only" }>;
type Insufficient = Extract<PlanJson, { kind: "insufficient_history" }>;

const pts = (rows: [string, number, number][]) =>
  rows.map(([date, value, invested]) => ({ date, value, invested }));

const LEVEL3_SCENARIOS: Scenarios = {
  lump: {
    from: "2017-01-17",
    to: "2026-10-14",
    invested: 2370000,
    finalValue: 7417103,
    xirr: 0.17919,
    cagr: null,
    maxDrawdown: -0.2719,
    volatility: 0.13158,
    worstYear: -0.2211,
    valueSeries: pts([
      ["2017-01-17", 615000, 615000],
      ["2018-05-31", 933730, 855000],
      ["2019-10-31", 1386695, 1110000],
      ["2021-03-31", 2159749, 1365000],
      ["2022-07-29", 2193328, 1605000],
      ["2023-12-29", 2869388, 1860000],
      ["2025-05-29", 3630206, 2115000],
      ["2026-10-14", 7417103, 2370000],
    ]),
  },
  dca: {
    from: "2017-01-17",
    to: "2026-10-14",
    invested: 2370000,
    finalValue: 7262254,
    xirr: 0.1801,
    cagr: null,
    maxDrawdown: -0.2719,
    volatility: 0.13155,
    worstYear: -0.2211,
    valueSeries: pts([
      ["2017-01-17", 65000, 65000],
      ["2018-05-31", 893487, 855000],
      ["2019-10-31", 1339332, 1110000],
      ["2021-03-31", 2096624, 1365000],
      ["2022-07-29", 2135595, 1605000],
      ["2023-12-29", 2801625, 1860000],
      ["2025-05-29", 3550533, 2115000],
      ["2026-10-14", 7262254, 2370000],
    ]),
  },
  plan: {
    from: "2017-01-17",
    to: "2026-10-14",
    invested: 2370000,
    finalValue: 7363648,
    xirr: 0.17982,
    cagr: null,
    maxDrawdown: -0.2719,
    volatility: 0.13156,
    worstYear: -0.2211,
    valueSeries: pts([
      ["2017-01-17", 115000, 115000],
      ["2018-05-31", 919838, 855000],
      ["2019-10-31", 1370345, 1110000],
      ["2021-03-31", 2137958, 1365000],
      ["2022-07-29", 2173399, 1605000],
      ["2023-12-29", 2845996, 1860000],
      ["2025-05-29", 3602702, 2115000],
      ["2026-10-14", 7363648, 2370000],
    ]),
  },
};

const LEVEL3_EQUITY: Scenarios = {
  lump: {
    from: "2007-12-26",
    to: "2026-10-14",
    invested: 4005000,
    finalValue: 32289904,
    xirr: 0.16903,
    cagr: null,
    maxDrawdown: -0.52633,
    volatility: 0.19129,
    worstYear: -0.47179,
    valueSeries: pts([
      ["2007-12-26", 615000, 615000],
      ["2010-07-30", 1168021, 1080000],
      ["2013-04-30", 1893321, 1575000],
      ["2015-12-31", 2617970, 2055000],
      ["2018-09-28", 4509253, 2550000],
      ["2021-05-31", 8311889, 3030000],
      ["2024-02-29", 10726504, 3525000],
      ["2026-10-14", 32289904, 4005000],
    ]),
  },
  dca: {
    from: "2007-12-26",
    to: "2026-10-14",
    invested: 4005000,
    finalValue: 33035434,
    xirr: 0.1724,
    cagr: null,
    maxDrawdown: -0.52625,
    volatility: 0.19127,
    worstYear: -0.47175,
    valueSeries: pts([
      ["2007-12-26", 65000, 65000],
      ["2010-07-30", 1231590, 1080000],
      ["2013-04-30", 1967544, 1575000],
      ["2015-12-31", 2701553, 2055000],
      ["2018-09-28", 4634068, 2550000],
      ["2021-05-31", 8521872, 3030000],
      ["2024-02-29", 10981781, 3525000],
      ["2026-10-14", 33035434, 4005000],
    ]),
  },
  plan: {
    from: "2007-12-26",
    to: "2026-10-14",
    invested: 4005000,
    finalValue: 32280517,
    xirr: 0.16964,
    cagr: null,
    maxDrawdown: -0.52634,
    volatility: 0.19128,
    worstYear: -0.47176,
    valueSeries: pts([
      ["2007-12-26", 115000, 115000],
      ["2010-07-30", 1167221, 1080000],
      ["2013-04-30", 1892386, 1575000],
      ["2015-12-31", 2616917, 2055000],
      ["2018-09-28", 4507681, 2550000],
      ["2021-05-31", 8309245, 3030000],
      ["2024-02-29", 10723290, 3525000],
      ["2026-10-14", 32280517, 4005000],
    ]),
  },
};

const LEVEL1_SCENARIOS: Scenarios = {
  lump: {
    from: "2017-01-17",
    to: "2026-10-14",
    invested: 2370000,
    finalValue: 3583429,
    xirr: 0.0661,
    cagr: null,
    maxDrawdown: -0.22929,
    volatility: 0.08886,
    worstYear: -0.20671,
    valueSeries: pts([
      ["2017-01-17", 615000, 615000],
      ["2018-05-31", 879337, 855000],
      ["2019-10-31", 1311470, 1110000],
      ["2021-03-31", 1689568, 1365000],
      ["2022-07-29", 1791829, 1605000],
      ["2023-12-29", 2170318, 1860000],
      ["2025-05-29", 2400840, 2115000],
      ["2026-10-14", 3583429, 2370000],
    ]),
  },
  dca: {
    from: "2017-01-17",
    to: "2026-10-14",
    invested: 2370000,
    finalValue: 3564356,
    xirr: 0.06656,
    cagr: null,
    maxDrawdown: -0.22929,
    volatility: 0.08888,
    worstYear: -0.20671,
    valueSeries: pts([
      ["2017-01-17", 65000, 65000],
      ["2018-05-31", 868158, 855000],
      ["2019-10-31", 1298396, 1110000],
      ["2021-03-31", 1675318, 1365000],
      ["2022-07-29", 1778591, 1605000],
      ["2023-12-29", 2156326, 1860000],
      ["2025-05-29", 2386914, 2115000],
      ["2026-10-14", 3564356, 2370000],
    ]),
  },
  plan: {
    from: "2017-01-17",
    to: "2026-10-14",
    invested: 2370000,
    finalValue: 3587396,
    xirr: 0.06681,
    cagr: null,
    maxDrawdown: -0.22929,
    volatility: 0.08888,
    worstYear: -0.20671,
    valueSeries: pts([
      ["2017-01-17", 115000, 115000],
      ["2018-05-31", 881661, 855000],
      ["2019-10-31", 1314188, 1110000],
      ["2021-03-31", 1692531, 1365000],
      ["2022-07-29", 1794581, 1605000],
      ["2023-12-29", 2173227, 1860000],
      ["2025-05-29", 2403736, 2115000],
      ["2026-10-14", 3587396, 2370000],
    ]),
  },
};

const LEVEL1_EQUITY: Scenarios = {
  lump: {
    from: "2007-12-26",
    to: "2026-10-14",
    invested: 4005000,
    finalValue: 28642995,
    xirr: 0.15992,
    cagr: null,
    maxDrawdown: -0.52885,
    volatility: 0.18101,
    worstYear: -0.47921,
    valueSeries: pts([
      ["2007-12-26", 615000, 615000],
      ["2010-07-30", 1186891, 1080000],
      ["2013-04-30", 1910457, 1575000],
      ["2015-12-31", 2579823, 2055000],
      ["2018-09-28", 4343956, 2550000],
      ["2021-05-31", 7805014, 3030000],
      ["2024-02-29", 10473675, 3525000],
      ["2026-10-14", 28642995, 4005000],
    ]),
  },
  dca: {
    from: "2007-12-26",
    to: "2026-10-14",
    invested: 4005000,
    finalValue: 29343186,
    xirr: 0.16328,
    cagr: null,
    maxDrawdown: -0.52889,
    volatility: 0.18099,
    worstYear: -0.47917,
    valueSeries: pts([
      ["2007-12-26", 65000, 65000],
      ["2010-07-30", 1255937, 1080000],
      ["2013-04-30", 1990929, 1575000],
      ["2015-12-31", 2668139, 2055000],
      ["2018-09-28", 4472377, 2550000],
      ["2021-05-31", 8015013, 3030000],
      ["2024-02-29", 10738248, 3525000],
      ["2026-10-14", 29343186, 4005000],
    ]),
  },
  plan: {
    from: "2007-12-26",
    to: "2026-10-14",
    invested: 4005000,
    finalValue: 28643410,
    xirr: 0.16051,
    cagr: null,
    maxDrawdown: -0.52889,
    volatility: 0.181,
    worstYear: -0.47918,
    valueSeries: pts([
      ["2007-12-26", 115000, 115000],
      ["2010-07-30", 1186932, 1080000],
      ["2013-04-30", 1910505, 1575000],
      ["2015-12-31", 2579875, 2055000],
      ["2018-09-28", 4344032, 2550000],
      ["2021-05-31", 7805138, 3030000],
      ["2024-02-29", 10473831, 3525000],
      ["2026-10-14", 28643410, 4005000],
    ]),
  },
};

const INSTRUMENTS: PlanOk["instruments"] = [
  { category: "core", symbol: "0050", name: "元大台灣50", alternate: "006208" },
  { category: "bond", symbol: "00679B", name: "元大美債20年", alternate: "00687B" },
  { category: "dividend", symbol: "0056", name: "元大高股息", alternate: "00713" },
];

const WINDOW: PlanOk["window"] = {
  from: "2017-01-17",
  to: "2026-10-14",
  years: 9.7,
  symbols: ["0050", "00679B", "0056"],
};

// The planner's own assumption strings (src/planner/plan-service.ts): the three fixed ones come
// with every response, the satellite one at levels 3-5, the last two with a full plan.
const SATELLITE_PROXY = "衛星部位以核心報酬代替，實際風險更高";
const FIXED_ASSUMPTIONS = [
  "含配息再投入，不計手續費與稅",
  "過去表現不代表未來",
  "年化報酬含投入時點（資金加權）",
];
const ASSUMPTIONS = [
  ...FIXED_ASSUMPTIONS,
  "三種試算投入的總金額相同，只差在投入時點",
  "只有股票的試算不含債券與現金",
];

/** Level 3, 600,000 investable, six tranche months, 15,000 a month; the reference result. */
export const LEVEL3_PLAN: PlanOk = {
  kind: "plan",
  profile: { capacity: 4, willingness: 3, level: 3, cappedByHorizon: false, reserveFirst: false },
  amounts: {
    reserveTarget: 90000,
    reserveGap: 0,
    reserveOnly: false,
    investable: 600000,
    slices: { core: 270000, bond: 150000, dividend: 120000, satellite: 30000, cash: 30000 },
    trancheMonths: 6,
    monthsToFillReserve: 0,
  },
  warnings: [],
  assumptions: [SATELLITE_PROXY, ...ASSUMPTIONS],
  instruments: INSTRUMENTS,
  rhythm: { trancheMonths: 6 },
  window: WINDOW,
  scenarios: LEVEL3_SCENARIOS,
  equityOnly: { ...LEVEL3_EQUITY, from: "2007-12-26", years: 18.8 },
};

/** Level 1: bond-heavy, no satellite slice, and a -22.93% worst fall in the test period. */
export const LEVEL1_PLAN: PlanOk = {
  ...LEVEL3_PLAN,
  profile: { capacity: 4, willingness: 1, level: 1, cappedByHorizon: false, reserveFirst: false },
  amounts: {
    ...LEVEL3_PLAN.amounts,
    slices: { core: 90000, bond: 330000, dividend: 90000, satellite: 0, cash: 90000 },
  },
  assumptions: ASSUMPTIONS,
  scenarios: LEVEL1_SCENARIOS,
  equityOnly: { ...LEVEL1_EQUITY, from: "2007-12-26", years: 18.8 },
};

/** The emergency reserve is short, so only the reserve plan is shown. */
export const RESERVE_ONLY_PLAN: Reserve = {
  kind: "reserve_only",
  profile: { capacity: 3, willingness: 3, level: 3, cappedByHorizon: false, reserveFirst: true },
  amounts: {
    reserveTarget: 90000,
    reserveGap: 70000,
    reserveOnly: true,
    investable: 0,
    slices: { core: 0, bond: 0, dividend: 0, satellite: 0, cash: 0 },
    trancheMonths: 1,
    monthsToFillReserve: 7,
  },
  warnings: [],
  assumptions: [SATELLITE_PROXY, ...FIXED_ASSUMPTIONS],
};

/** Less than a year of history: allocation and rhythm only, no instruments or scenarios. */
export const INSUFFICIENT_HISTORY_PLAN: Insufficient = {
  kind: "insufficient_history",
  profile: LEVEL3_PLAN.profile,
  amounts: LEVEL3_PLAN.amounts,
  warnings: [],
  assumptions: [SATELLITE_PROXY, ...FIXED_ASSUMPTIONS],
};

/** The bond ETF is not eligible: its slice is held as cash and the response says so. */
export const BOND_AS_CASH_PLAN: PlanOk = {
  ...LEVEL3_PLAN,
  amounts: {
    ...LEVEL3_PLAN.amounts,
    slices: { core: 270000, bond: 0, dividend: 120000, satellite: 30000, cash: 180000 },
  },
  warnings: ["債券標的暫時沒有符合條件的 ETF，債券部位以現金計算"],
  instruments: INSTRUMENTS.filter((i) => i.category !== "bond"),
  window: { ...WINDOW, symbols: ["0050", "0056"] },
};

/** A window too short to solve xirr and worstYear: both come back null. */
export const NULL_METRICS_PLAN: PlanOk = {
  ...LEVEL3_PLAN,
  scenarios: {
    lump: { ...LEVEL3_PLAN.scenarios.lump, xirr: null, worstYear: null },
    dca: { ...LEVEL3_PLAN.scenarios.dca, xirr: null, worstYear: null },
    plan: { ...LEVEL3_PLAN.scenarios.plan, xirr: null, worstYear: null },
  },
  equityOnly: null,
};

/** Level 1 whose bond ETF is not eligible: the bond slice is held as cash, so no bond note. */
export const LEVEL1_BOND_AS_CASH_PLAN: PlanOk = {
  ...LEVEL1_PLAN,
  amounts: {
    ...LEVEL1_PLAN.amounts,
    slices: { core: 90000, bond: 0, dividend: 90000, satellite: 0, cash: 420000 },
  },
  warnings: ["債券標的暫時沒有符合條件的 ETF，債券部位以現金計算"],
  instruments: LEVEL1_PLAN.instruments.filter((i) => i.category !== "bond"),
  window: { ...LEVEL1_PLAN.window, symbols: ["0050", "0056"] },
};

/**
 * The dividend ETF is not eligible: its slice is held as cash, so the equity-only run is core
 * alone. The scenario numbers are LEVEL3's, reused for shape only.
 */
export const DIVIDEND_AS_CASH_PLAN: PlanOk = {
  ...LEVEL3_PLAN,
  amounts: {
    ...LEVEL3_PLAN.amounts,
    slices: { core: 270000, bond: 150000, dividend: 0, satellite: 30000, cash: 150000 },
  },
  warnings: ["高股息標的暫時沒有符合條件的 ETF，高股息部位以現金計算"],
  instruments: INSTRUMENTS.filter((i) => i.category !== "dividend"),
  window: { ...WINDOW, symbols: ["0050", "00679B"] },
};

/** A stored level-3 explanation: no amounts of the reader's, two glossary terms (also in `terms`). */
export const EXPLANATION_FIXTURE: PlanExplanationJson = {
  explanation: {
    level: 3,
    lens: "beginner",
    periodKey: "2026-W42",
    promptVersion: 1,
    model: "test",
    createdAt: "2026-10-12T02:00:00.000Z",
    content: {
      headline: "這個等級偏平衡，漲跌都會有",
      summary: "股票負責成長，債券和現金讓整體不要晃得太大。",
      sections: [
        { title: "為什麼這樣分", body: "核心股票放最多，債券拿來緩衝下跌。" },
        { title: "過去的起伏", body: "測試期間最深曾經跌過兩成多，接著又漲回來。" },
      ],
      takeaway: "先看自己睡不睡得著，再決定投入的節奏。",
      termIds: ["max-drawdown", "dca"],
    },
  },
  terms: Object.fromEntries(
    GLOSSARY.filter((t) => t.id === "max-drawdown" || t.id === "dca").map((t) => [t.id, t]),
  ),
};
