import { describe, expect, it } from "vitest";
import type { PlanReference } from "@/planner/plan-service";
import { LEVEL3_REFERENCE } from "../../test/helpers/plan-fixtures";
import { buildPlanFacts } from "./facts-plan";
import { checkGrounding, extractNumbers } from "./grounding";

const BOND_AS_CASH = "債券標的暫時沒有符合條件的 ETF，債券部位以現金計算";

const level3 = LEVEL3_REFERENCE;
const { metrics } = level3;

const level1BondAsCash: PlanReference = {
  ...level3,
  level: 1,
  weights: { core: 15, bond: 0, dividend: 15, satellite: 0, cash: 70 },
  instruments: level3.instruments.filter((i) => i.category !== "bond"),
  warnings: [BOND_AS_CASH],
};

describe("buildPlanFacts", () => {
  const facts = buildPlanFacts(level3);
  const lines = facts.text.split("\n");

  it("keys the sheet by the ISO week of the run date", () => {
    expect(facts.periodKey).toBe("2026-W42");
  });

  it("names the level and every held slice with its integer weight and instrument", () => {
    expect(lines).toContain("- 風險等級：3（平衡）");
    expect(facts.text).toContain("- 核心：市值型 ETF 45%，標的是 元大台灣50（0050）");
    expect(facts.text).toContain("- 債券：債券 ETF 25%，標的是 元大美債20年（00679B）");
    expect(facts.text).toContain("- 高股息：高股息 ETF 20%，標的是 元大高股息（0056）");
    expect(facts.text).toContain("- 衛星：5%");
    expect(facts.text).toContain("- 現金：5%");
  });

  it("writes the window, the run method and the metrics as percent with two decimals", () => {
    expect(lines).toContain("- 資料期間：2017-01-17 至 2026-10-14（9.7 年）");
    expect(facts.text).toContain("一次性的歷史試算");
    expect(facts.text).toContain("每年依目標比例再平衡一次");
    expect(facts.text).toContain("配息再投入");
    expect(facts.text).toContain(
      "年化報酬率 +7.35%、最大回撤 -23.46%、年化波動度 12.34%、最差滾動十二個月 -15.67%",
    );
    expect(lines).toContain("- 資料到：2026-10-15");
  });

  it("writes the equity-only run with its own period, labelled 只有股票", () => {
    const line = lines.find((l) => l.includes("只有股票"));
    expect(line).toContain("2008-01-02 起（18.8 年）");
    expect(line).toContain(
      "年化報酬率 +10.12%、最大回撤 -33.01%、年化波動度 17.02%、最差滾動十二個月 -28.11%",
    );
    expect(buildPlanFacts({ ...level3, equityOnly: null }).text).not.toContain("只有股票");
  });

  it("grounds a sentence copying its figures and rejects an invented one", () => {
    const copied =
      "核心 45%、債券 25%、高股息 20%；2017-01-17 至 2026-10-14 這 9.7 年，年化報酬率 +7.35%，最大回撤 -23.5%，0050 與 00679B。";
    expect(checkGrounding(copied, facts)).toEqual({ ok: true, ungrounded: [] });
    expect(checkGrounding("年化報酬率 31.4%", facts)).toEqual({ ok: false, ungrounded: [31.4] });
  });

  it("omits a 0% slice", () => {
    const level1 = buildPlanFacts({
      ...level3,
      level: 1,
      weights: { core: 15, bond: 55, dividend: 15, satellite: 0, cash: 15 },
    });
    expect(level1.text).toContain("- 風險等級：1（保守）");
    expect(level1.text).not.toContain("衛星");
    const level5 = buildPlanFacts({
      ...level3,
      level: 5,
      weights: { core: 70, bond: 0, dividend: 15, satellite: 15, cash: 0 },
      instruments: level3.instruments.filter((i) => i.category !== "bond"),
      equityOnly: null,
    });
    expect(level5.text).toContain("- 風險等級：5（進取）");
    expect(level5.text).not.toContain("債券");
    expect(level5.text).not.toContain("現金");
    expect(level5.text).not.toMatch(/\b0%/);
  });

  it("writes a bond slice held as cash as cash with the warning", () => {
    const text = buildPlanFacts(level1BondAsCash).text;
    expect(text).toContain("- 現金：70%");
    expect(text).toContain(BOND_AS_CASH);
    expect(text).not.toContain("- 債券：");
  });

  it("omits null metrics", () => {
    const text = buildPlanFacts({
      ...level3,
      metrics: { ...metrics, cagr: null, worstYear: null },
    }).text;
    expect(text).toContain("最大回撤 -23.46%、年化波動度 12.34%");
    expect(text.split("\n").find((l) => l.startsWith("- 歷史試算結果"))).toBe(
      "- 歷史試算結果：最大回撤 -23.46%、年化波動度 12.34%",
    );
  });

  it("holds no money amount", () => {
    for (const reference of [level3, level1BondAsCash]) {
      const text = buildPlanFacts(reference).text;
      expect(extractNumbers(text).every((n) => Math.abs(n) < 10_000)).toBe(true);
      expect(text).not.toMatch(/\d\s*(元|萬|億)/);
    }
  });

  it("throws for weights that do not sum to 100", () => {
    expect(() => buildPlanFacts({ ...level3, weights: { ...level3.weights, cash: 10 } })).toThrow(
      /100/,
    );
  });

  it("throws for a held fund slice without an instrument", () => {
    expect(() => buildPlanFacts({ ...level3, instruments: level3.instruments.slice(1) })).toThrow(
      /core/,
    );
  });
});
