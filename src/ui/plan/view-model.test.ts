import { describe, expect, it } from "vitest";
import { planResponseSchema } from "@/planner/schema";
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
    ["RESERVE_ONLY_PLAN", RESERVE_ONLY_PLAN],
    ["INSUFFICIENT_HISTORY_PLAN", INSUFFICIENT_HISTORY_PLAN],
    ["BOND_AS_CASH_PLAN", BOND_AS_CASH_PLAN],
    ["NULL_METRICS_PLAN", NULL_METRICS_PLAN],
  ])("%s parses with the response schema", (_name, plan) => {
    expect(planResponseSchema.safeParse(plan).success).toBe(true);
  });

  it("ends every series on its finalValue", () => {
    for (const plan of [LEVEL3_PLAN, LEVEL1_PLAN]) {
      const runs = [
        ...Object.values(plan.scenarios),
        ...Object.values(plan.equityOnly ?? {}).filter(
          (v): v is PlanOk["scenarios"]["plan"] => typeof v === "object" && v !== null,
        ),
      ];
      for (const run of runs) expect(run.valueSeries.at(-1)?.value).toBe(run.finalValue);
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

describe("reserveView", () => {
  it("reads the target, the gap and the months to fill", () => {
    expect(reserveView(LEVEL3_PLAN)).toEqual({
      target: 90000,
      gap: 0,
      funded: true,
      monthsToFill: 0,
    });
    expect(reserveView(RESERVE_ONLY_PLAN)).toEqual({
      target: 90000,
      gap: 70000,
      funded: false,
      monthsToFill: 7,
    });
  });
});

describe("notices", () => {
  it("has none for a plain level-3 plan", () => {
    expect(notices(LEVEL3_PLAN)).toEqual([]);
  });

  it("explains a reserve-only plan with the gap and the months to fill", () => {
    const [n, ...rest] = notices(RESERVE_ONLY_PLAN);
    expect(rest).toEqual([]);
    expect(n?.id).toBe("reserve-only");
    expect(n?.body).toContain("70,000");
    expect(n?.body).toContain("7 個月");
  });

  it("says so when the reserve cannot be filled from the monthly amount", () => {
    const stuck = {
      ...RESERVE_ONLY_PLAN,
      amounts: { ...RESERVE_ONLY_PLAN.amounts, monthsToFillReserve: null },
    };
    const [n] = notices(stuck);
    expect(n?.body).toContain("70,000");
    expect(n?.body).not.toMatch(/null|undefined|NaN/);
    expect(n?.body).not.toContain("個月可以補齊");
  });

  it("turns each warning into a warn notice", () => {
    const list = notices(BOND_AS_CASH_PLAN);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      tone: "warn",
      body: "債券標的暫時沒有符合條件的 ETF，債券部位以現金計算",
    });
  });

  it("explains a horizon cap as info", () => {
    const capped: PlanOk = {
      ...LEVEL3_PLAN,
      profile: { ...LEVEL3_PLAN.profile, cappedByHorizon: true },
    };
    const list = notices(capped);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "capped-by-horizon", tone: "info" });
  });

  it("warns when there is less than a year of history", () => {
    const list = notices(INSUFFICIENT_HISTORY_PLAN);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "insufficient-history", tone: "warn" });
  });

  it("adds the level-1 note with the drawdown from the response", () => {
    const list = notices(LEVEL1_PLAN);
    expect(list).toHaveLength(1);
    expect(list[0]?.tone).toBe("info");
    expect(list[0]?.body).toBe(
      "這個等級的債券部分是 20 年期以上的美國公債 ETF；測試期間它仍然下跌了約兩成（最大回撤 -22.93%）。",
    );
  });

  it("formats the level-1 percentage from whatever the response says", () => {
    expect(notices(withDrawdown(-0.2)).at(0)?.body).toContain("-20.00%");
  });

  it("says about two tenths only between -15% and -30%, inclusive of the printed value", () => {
    const about = (dd: number) => notices(withDrawdown(dd))[0]?.body ?? "";
    expect(about(-0.15)).toContain("約兩成");
    expect(about(-0.3)).toContain("約兩成");
    expect(about(-0.1499)).not.toContain("約兩成");
    expect(about(-0.3001)).not.toContain("約兩成");
    expect(about(-0.4)).not.toContain("約兩成");
    expect(about(-0.4)).toContain("-40.00%");
  });

  it("does not add the level-1 note for other levels", () => {
    expect(notices(LEVEL3_PLAN).some((n) => n.id === "level1-bond")).toBe(false);
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
