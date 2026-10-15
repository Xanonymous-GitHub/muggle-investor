import { describe, expect, it } from "vitest";
import { planResponseSchema } from "@/planner/schema";
import type { PlanJson } from "@/ui/data/api";
import { HISTORY_LABELS, scenarioLabel } from "@/ui/plan/copy";
import {
  historyView,
  notices,
  type PlanOk,
  reserveView,
  rhythmLines,
  sliceRows,
} from "@/ui/plan/view-model";
import {
  BOND_AS_CASH_PLAN,
  INSUFFICIENT_HISTORY_PLAN,
  LEVEL1_BOND_AS_CASH_PLAN,
  LEVEL1_PLAN,
  LEVEL3_PLAN,
  NULL_METRICS_PLAN,
  RESERVE_ONLY_PLAN,
} from "@/ui/test/plan-fixture";

const withDrawdown = (maxDrawdown: number): PlanOk => ({
  ...LEVEL1_PLAN,
  scenarios: {
    ...LEVEL1_PLAN.scenarios,
    plan: { ...LEVEL1_PLAN.scenarios.plan, maxDrawdown },
  },
});

describe("plan fixtures", () => {
  it.each([
    ["LEVEL3_PLAN", LEVEL3_PLAN],
    ["LEVEL1_PLAN", LEVEL1_PLAN],
    ["LEVEL1_BOND_AS_CASH_PLAN", LEVEL1_BOND_AS_CASH_PLAN],
    ["RESERVE_ONLY_PLAN", RESERVE_ONLY_PLAN],
    ["INSUFFICIENT_HISTORY_PLAN", INSUFFICIENT_HISTORY_PLAN],
    ["BOND_AS_CASH_PLAN", BOND_AS_CASH_PLAN],
    ["NULL_METRICS_PLAN", NULL_METRICS_PLAN],
  ])("%s parses with the response schema", (_name, plan) => {
    expect(planResponseSchema.safeParse(plan).success).toBe(true);
  });

  it.each([
    ["LEVEL3_PLAN", LEVEL3_PLAN],
    ["LEVEL1_PLAN", LEVEL1_PLAN],
  ])("%s keeps the invariants of a real response", (_name, plan) => {
    const main = Object.values(plan.scenarios);
    expect(new Set(main.map((run) => run.invested)).size).toBe(1);
    expect(plan.scenarios.plan.valueSeries[0]).toEqual({
      date: "2017-01-17",
      value: 115000,
      invested: 115000,
    });
    const { equityOnly } = plan;
    if (equityOnly === null) throw new Error("fixture has an equity-only run");
    const equity = [equityOnly.lump, equityOnly.dca, equityOnly.plan];
    expect(new Set(equity.map((run) => run.invested)).size).toBe(1);
    expect(equity[0]?.valueSeries[0]?.date).toBe("2007-12-26");
    for (const run of [...main, ...equity]) {
      expect(run.valueSeries.at(-1)?.value).toBe(run.finalValue);
      expect(run.valueSeries.at(-1)?.invested).toBe(run.invested);
      expect(run.valueSeries.at(-1)?.date).toBe(run.to);
    }
    for (const runs of [main, equity]) {
      const dates = runs.map((run) => run.valueSeries.map((p) => p.date).join());
      expect(new Set(dates).size).toBe(1);
    }
  });
});

describe("sliceRows", () => {
  it("lists the five level-3 slices with amounts, whole-number shares and details", () => {
    const rows = sliceRows(LEVEL3_PLAN);
    expect(rows.map((r) => r.key)).toEqual(["core", "bond", "dividend", "satellite", "cash"]);
    expect(rows.map((r) => r.label)).toEqual([
      "核心：市值型 ETF",
      "債券 ETF",
      "高股息 ETF",
      "衛星",
      "現金",
    ]);
    expect(rows.map((r) => r.amount)).toEqual([270000, 150000, 120000, 30000, 30000]);
    expect(rows.map((r) => r.percent)).toEqual([45, 25, 20, 5, 5]);
    expect(rows[0]?.detail).toBe("元大台灣50（0050）　備選 006208");
    expect(rows[1]?.detail).toBe("元大美債20年（00679B）　備選 00687B");
    expect(rows[2]?.detail).toBe("元大高股息（0056）　備選 00713");
    expect(rows[3]?.detail).toBe("沒有指定單一標的，試算時以核心標的的含息報酬代替");
    expect(rows[4]?.detail).toBe("試算時不計報酬");
  });

  it("leaves out a slice of zero, so level 1 has no satellite row", () => {
    expect(sliceRows(LEVEL1_PLAN).map((r) => r.key)).toEqual(["core", "bond", "dividend", "cash"]);
  });

  it("omits the alternate when the instrument has none", () => {
    const plan: PlanOk = {
      ...LEVEL3_PLAN,
      instruments: LEVEL3_PLAN.instruments.map((i) =>
        i.category === "core" ? { ...i, alternate: null } : i,
      ),
    };
    expect(sliceRows(plan)[0]?.detail).toBe("元大台灣50（0050）");
  });

  it("has no detail for a fund slice whose instrument is missing", () => {
    const rows = sliceRows(BOND_AS_CASH_PLAN);
    expect(rows.map((r) => r.key)).toEqual(["core", "dividend", "satellite", "cash"]);
    expect(rows.find((r) => r.key === "cash")?.amount).toBe(180000);
    expect(rows.find((r) => r.key === "cash")?.percent).toBe(30);
    expect(sliceRows(INSUFFICIENT_HISTORY_PLAN)[0]?.detail).toBeNull();
  });

  it("has no detail for a plan-kind slice that has weight but no instrument", () => {
    const plan: PlanOk = {
      ...LEVEL3_PLAN,
      instruments: LEVEL3_PLAN.instruments.filter((i) => i.category !== "bond"),
    };
    const bond = sliceRows(plan).find((r) => r.key === "bond");
    expect(bond?.amount).toBe(150000);
    expect(bond?.detail).toBeNull();
  });

  it("is empty for reserve_only", () => {
    expect(sliceRows(RESERVE_ONLY_PLAN)).toEqual([]);
  });
});

describe("rhythmLines", () => {
  it("splits the lump over the tranche months, then continues with the monthly amount", () => {
    expect(rhythmLines(LEVEL3_PLAN, 15000)).toEqual([
      { when: "第 1–6 個月", what: expect.stringContaining("115,000") },
      { when: "第 7 個月起", what: expect.stringContaining("15,000") },
    ]);
  });

  it("explains the first line by lens and keeps the second to the monthly amount", () => {
    const [first, second] = rhythmLines(LEVEL3_PLAN, 15000, "beginner");
    expect(first?.what).toContain("100,000");
    expect(second?.what).not.toContain("115,000");
    const [proFirst] = rhythmLines(LEVEL3_PLAN, 15000, "pro");
    expect(proFirst?.what).not.toBe(first?.what);
    expect(proFirst?.what).toContain("115,000");
  });

  it("rounds the monthly share down and puts the remainder in month 1, like the engine", () => {
    const odd: PlanOk = {
      ...LEVEL3_PLAN,
      amounts: { ...LEVEL3_PLAN.amounts, investable: 100001 },
    };
    const [first] = rhythmLines(odd, 0, "beginner");
    expect(first?.what).toContain("16,666");
    expect(first?.what).toContain("16,671");
    expect(first?.what).toContain("5 元");
    const [withMonthly, ongoing] = rhythmLines(odd, 10000, "pro");
    expect(withMonthly?.what).toContain("26,666");
    expect(withMonthly?.what).toContain("26,671");
    expect(ongoing?.what).toContain("10,000");
  });

  it("is a single line when the lump goes in at once", () => {
    const once: PlanOk = { ...LEVEL3_PLAN, rhythm: { trancheMonths: 1 } };
    const lines = rhythmLines(once, 15000);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.what).toContain("600,000");
    expect(lines[0]?.what).toContain("15,000");
  });

  it("drops the second line without a monthly amount", () => {
    const lines = rhythmLines(LEVEL3_PLAN, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.when).toBe("第 1–6 個月");
    expect(lines[0]?.what).toContain("100,000");
  });

  it("uses the raw rule months for a response without scenarios and none for reserve_only", () => {
    expect(rhythmLines(INSUFFICIENT_HISTORY_PLAN, 15000)[0]?.when).toBe("第 1–6 個月");
    expect(rhythmLines(RESERVE_ONLY_PLAN, 15000)).toEqual([]);
  });
});

/** Target 90,000 and 20,000 in hand: a gap of 70,000, filled by lump first, then 10,000 a month. */
const reserveCase = (lump: number, monthly: number): PlanJson => {
  const gap = 70000;
  const remaining = Math.max(0, gap - lump);
  const months = remaining === 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null;
  return {
    ...RESERVE_ONLY_PLAN,
    amounts: {
      ...RESERVE_ONLY_PLAN.amounts,
      reserveGap: gap,
      monthsToFillReserve: months,
    },
  };
};

describe("reserveView", () => {
  it("is not funded while the monthly amount still has to fill the remainder", () => {
    expect(reserveView(reserveCase(30000, 10000), 30000)).toEqual({
      target: 90000,
      gap: 70000,
      have: 20000,
      deposit: 30000,
      remainingGap: 40000,
      funded: false,
      monthsToFill: 4,
    });
  });

  it("is funded when the lump equals the gap", () => {
    const view = reserveView(reserveCase(70000, 10000), 70000);
    expect(view).toMatchObject({ deposit: 70000, remainingGap: 0, funded: true, monthsToFill: 0 });
  });

  it("is funded when a plan-kind response's lump covers the gap", () => {
    const covered: PlanJson = {
      ...LEVEL3_PLAN,
      amounts: { ...LEVEL3_PLAN.amounts, reserveGap: 70000, monthsToFillReserve: 0 },
    };
    const view = reserveView(covered, 100000);
    expect(view).toMatchObject({ deposit: 70000, remainingGap: 0, funded: true });
  });

  it("has no months to fill without a monthly amount", () => {
    const view = reserveView(reserveCase(0, 0), 0);
    expect(view).toMatchObject({ deposit: 0, remainingGap: 70000, funded: false });
    expect(view.monthsToFill).toBeNull();
  });
});

describe("notices", () => {
  it("has none for a plain level-3 plan", () => {
    expect(notices(LEVEL3_PLAN, 600000)).toEqual([]);
  });

  it("states target, have, this time's deposit, the remainder and the months for it", () => {
    const [n, ...rest] = notices(reserveCase(30000, 10000), 30000);
    expect(rest).toEqual([]);
    expect(n?.id).toBe("reserve-only");
    expect(n?.body).toContain("90,000");
    expect(n?.body).toContain("20,000");
    expect(n?.body).toContain("30,000");
    expect(n?.body).toContain("40,000");
    expect(n?.body).toContain("4 個月");
  });

  it("leaves out the deposit when no lump goes in", () => {
    const [n] = notices(reserveCase(0, 10000), 0);
    expect(n?.body).toContain("70,000");
    expect(n?.body).toContain("7 個月");
    expect(n?.body).not.toContain("這次放進");
  });

  it("says the reserve is complete this time when the lump equals the gap", () => {
    const [n] = notices(reserveCase(70000, 10000), 70000);
    expect(n?.body).toContain("這次就能補滿");
    expect(n?.body).not.toContain("0 個月");
  });

  it("says there is no monthly amount when it cannot fill the remainder", () => {
    const [n] = notices(reserveCase(30000, 0), 30000);
    expect(n?.body).toContain("40,000");
    expect(n?.body).toContain("目前沒有每月投入的金額");
    expect(n?.body).not.toMatch(/null|undefined|NaN/);
    expect(n?.body).not.toContain("個月可以補齊");
  });

  it("turns each warning into a warn notice", () => {
    const list = notices(BOND_AS_CASH_PLAN, 600000);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      tone: "warn",
      body: "債券標的暫時沒有符合條件的 ETF，債券部位以現金計算",
    });
  });

  it("explains a horizon cap as info, without naming a horizon", () => {
    const capped: PlanOk = {
      ...LEVEL3_PLAN,
      profile: { ...LEVEL3_PLAN.profile, cappedByHorizon: true },
    };
    const list = notices(capped, 600000);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "capped-by-horizon", tone: "info" });
    expect(list[0]?.body).toBe("這筆錢可能在幾年內要用，所以配置被限制在比較保守的範圍。");
    expect(list[0]?.body).not.toContain("建議");
  });

  it("warns when there is less than a year of history", () => {
    const list = notices(INSUFFICIENT_HISTORY_PLAN, 600000);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "insufficient-history", tone: "warn" });
  });

  it("names the bond ETF and the whole mix's fall in the level-1 note", () => {
    const list = notices(LEVEL1_PLAN, 600000);
    expect(list).toHaveLength(1);
    expect(list[0]?.tone).toBe("info");
    expect(list[0]?.body).toBe(
      "這個等級有 55% 放在債券 ETF（元大美債20年，00679B），是 20 年期以上的美國公債。整體配置在測試期間最深曾從高點下跌 22.93%。",
    );
  });

  it("adds the professional term to the level-1 note for the pro lens", () => {
    expect(notices(LEVEL1_PLAN, 600000, "pro")[0]?.body).toContain("（最大回撤 -22.93%）");
  });

  it("formats the level-1 percentages from whatever the response says", () => {
    const plan = withDrawdown(-0.4);
    expect(notices(plan, 600000)[0]?.body).toContain("下跌 40.00%");
    expect(notices(plan, 600000)[0]?.body).not.toContain("約兩成");
    const heavier: PlanOk = {
      ...plan,
      amounts: {
        ...plan.amounts,
        slices: { core: 60000, bond: 360000, dividend: 90000, satellite: 0, cash: 90000 },
      },
    };
    expect(notices(heavier, 600000)[0]?.body).toContain("有 60% 放在債券 ETF");
  });

  it("has no level-1 note when the bond slice is held as cash", () => {
    expect(notices(LEVEL1_BOND_AS_CASH_PLAN, 600000).map((n) => n.id)).toEqual(["warning-0"]);
  });

  it("has no level-1 note when the bond slice has money but no bond instrument", () => {
    const plan: PlanOk = {
      ...LEVEL1_PLAN,
      instruments: LEVEL1_PLAN.instruments.filter((i) => i.category !== "bond"),
    };
    expect(notices(plan, 600000)).toEqual([]);
  });

  it.each([2, 3, 4, 5] as const)("has no level-1 note at level %i", (level) => {
    const plan: PlanOk = { ...LEVEL1_PLAN, profile: { ...LEVEL1_PLAN.profile, level } };
    expect(notices(plan, 600000)).toEqual([]);
  });

  it("never uses the forbidden forward-looking words in notices or rhythm lines", () => {
    const plans: PlanJson[] = [
      LEVEL3_PLAN,
      LEVEL1_PLAN,
      reserveCase(30000, 10000),
      reserveCase(70000, 10000),
      reserveCase(30000, 0),
      INSUFFICIENT_HISTORY_PLAN,
      { ...LEVEL3_PLAN, profile: { ...LEVEL3_PLAN.profile, cappedByHorizon: true } },
    ];
    const texts = plans.flatMap((plan) =>
      (["beginner", "pro"] as const).flatMap((lens) => [
        ...notices(plan, 30000, lens).flatMap((n) => [n.title, n.body]),
        ...rhythmLines(plan, 15000, lens).flatMap((l) => [l.when, l.what]),
        ...rhythmLines({ ...LEVEL3_PLAN, rhythm: { trancheMonths: 1 } }, 15000, lens).map(
          (l) => l.what,
        ),
      ]),
    );
    for (const text of texts) expect(text).not.toMatch(/之後|未來|預期|保證/);
  });
});

describe("historyView", () => {
  it("shows the main window with the three scenarios in order and the plan's metrics", () => {
    const view = historyView(LEVEL3_PLAN, "main");
    expect(view?.window).toEqual({ from: "2017-01-17", to: "2026-10-14", years: 9.7 });
    expect(view?.rows.map((r) => r.key)).toEqual(["lump", "dca", "plan"]);
    expect(view?.rows.map((r) => r.finalValue)).toEqual([7417103, 7262254, 7363648]);
    expect(view?.rows.every((r) => r.invested === 2370000)).toBe(true);
    expect(view?.rows.map((r) => r.xirr)).toEqual([0.17919, 0.1801, 0.17982]);
    expect(view?.metrics.maxDrawdown).toBeCloseTo(-0.2719, 4);
    expect(view?.metrics.worstYear).toBeCloseTo(-0.2211, 4);
    expect(view?.metrics.volatility).toBeCloseTo(0.1316, 3);
  });

  it("zips the three series by index, taking invested from the plan series", () => {
    const view = historyView(LEVEL3_PLAN, "main");
    expect(view?.series).toHaveLength(8);
    expect(view?.series[0]).toEqual({
      date: "2017-01-17",
      lump: 615000,
      dca: 65000,
      plan: 115000,
      invested: 115000,
    });
    expect(view?.series.at(-1)).toEqual({
      date: "2026-10-14",
      lump: 7417103,
      dca: 7262254,
      plan: 7363648,
      invested: 2370000,
    });
  });

  it("starts the equity-only window earlier and ends it with the main window", () => {
    const view = historyView(LEVEL3_PLAN, "equity");
    expect(view?.window).toEqual({ from: "2007-12-26", to: "2026-10-14", years: 18.8 });
    expect(view?.rows.map((r) => r.key)).toEqual(["lump", "dca", "plan"]);
    expect(view?.rows.at(2)?.finalValue).toBe(32280517);
    expect(view?.rows.at(2)?.invested).toBe(4005000);
    expect(view?.metrics.maxDrawdown).toBeCloseTo(-0.52634, 5);
    expect(view?.series[0]?.date).toBe("2007-12-26");
  });

  it("takes the equity window's end from the main window", () => {
    const moved: PlanOk = { ...LEVEL3_PLAN, window: { ...LEVEL3_PLAN.window, to: "2026-10-15" } };
    expect(historyView(moved, "equity")?.window.to).toBe("2026-10-15");
  });

  it("is null for equity when the response has no equity-only run", () => {
    expect(historyView(NULL_METRICS_PLAN, "equity")).toBeNull();
    expect(historyView(NULL_METRICS_PLAN, "main")).not.toBeNull();
  });

  it("keeps null xirr and worstYear as null", () => {
    const view = historyView(NULL_METRICS_PLAN, "main");
    expect(view?.rows.map((r) => r.xirr)).toEqual([null, null, null]);
    expect(view?.metrics.worstYear).toBeNull();
  });

  it("throws when the three series differ in length", () => {
    const short: PlanOk = {
      ...LEVEL3_PLAN,
      scenarios: {
        ...LEVEL3_PLAN.scenarios,
        dca: {
          ...LEVEL3_PLAN.scenarios.dca,
          valueSeries: LEVEL3_PLAN.scenarios.dca.valueSeries.slice(0, -1),
        },
      },
    };
    expect(() => historyView(short, "main")).toThrow();
  });

  it("throws when the series disagree on a date", () => {
    const series = LEVEL3_PLAN.scenarios.lump.valueSeries.map((p, i) =>
      i === 3 ? { ...p, date: "2021-04-01" } : p,
    );
    const shifted: PlanOk = {
      ...LEVEL3_PLAN,
      scenarios: {
        ...LEVEL3_PLAN.scenarios,
        lump: { ...LEVEL3_PLAN.scenarios.lump, valueSeries: series },
      },
    };
    expect(() => historyView(shifted, "main")).toThrow();
  });
});

describe("history labels", () => {
  it("names the scenarios the same way in both lenses", () => {
    for (const lens of ["beginner", "pro"] as const) {
      expect(scenarioLabel("lump", lens, 6)).toBe("一次投入");
      expect(scenarioLabel("dca", lens, 6)).toBe("分 12 個月");
      expect(scenarioLabel("plan", lens, 6)).toBe("依建議（6 個月）");
      expect(scenarioLabel("plan", lens, 1)).toBe("依建議（一次投入）");
    }
  });

  it("uses plain words for beginners and the terms for professionals", () => {
    expect(HISTORY_LABELS.beginner.metrics).toEqual({
      maxDrawdown: "最深曾經跌",
      worstYear: "最差的連續一年",
      volatility: "上下震盪幅度",
      xirr: "換算成每年",
    });
    expect(HISTORY_LABELS.pro.metrics).toEqual({
      maxDrawdown: "最大回撤",
      worstYear: "最差滾動十二個月",
      volatility: "年化波動度",
      xirr: "XIRR",
    });
  });
});
