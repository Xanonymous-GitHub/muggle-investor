import { describe, expect, it } from "vitest";
import { collectNumbers, extractNumbers, findUnsupportedNumbers } from "./verify";

describe("extractNumbers", () => {
  it("keeps percent signs and units out of the value", () => {
    expect(extractNumbers("漲了 5.5%，成交 1,234.5 萬")).toEqual([5.5, 12_345_000]);
    expect(extractNumbers("-3.2%")).toEqual([-3.2]);
  });

  it("handles thousands separators, units and full-width digits", () => {
    expect(extractNumbers("1,500,000")).toEqual([1_500_000]);
    expect(extractNumbers("150萬 與 150 萬 與 1.5億")).toEqual([1_500_000, 1_500_000, 150_000_000]);
    expect(extractNumbers("150w 1.5M 1.5m")).toEqual([1_500_000, 1_500_000, 1_500_000]);
    expect(extractNumbers("１，２３４．５")).toEqual([1234.5]);
    expect(extractNumbers("５．５％")).toEqual([5.5]);
  });

  it("does not read dates and times as numbers", () => {
    expect(extractNumbers("2026-10-14 收盤 105.5")).toEqual([105.5]);
    expect(extractNumbers("10/14 收盤 105.5")).toEqual([105.5]);
    expect(extractNumbers("10月14日 09:30 收盤 105.5")).toEqual([105.5]);
    expect(extractNumbers("2026/10/14")).toEqual([]);
  });

  it("returns an empty list for text without numbers", () => {
    expect(extractNumbers("沒有數字")).toEqual([]);
  });
});

describe("findUnsupportedNumbers", () => {
  const grounded = [100, 105.5];

  it("does not flag a figure derivable from two grounded numbers", () => {
    expect(findUnsupportedNumbers("上漲了 5.5%", grounded)).toEqual([]);
    expect(findUnsupportedNumbers("兩者相加 205.5", grounded)).toEqual([]);
    expect(findUnsupportedNumbers("差距 5.5", grounded)).toEqual([]);
    expect(findUnsupportedNumbers("比值約 1.055", grounded)).toEqual([]);
  });

  it("accepts a grounded number as is", () => {
    expect(findUnsupportedNumbers("漲到 105.5", grounded)).toEqual([]);
    expect(findUnsupportedNumbers("1,234.5", [1234.5])).toEqual([]);
  });

  it("flags a number that is neither grounded nor derivable", () => {
    expect(findUnsupportedNumbers("漲了 20%", grounded)).toEqual(["20%"]);
    expect(findUnsupportedNumbers("目標價 888", grounded)).toEqual(["888"]);
  });

  it("matches signed percentages and direction-free wording", () => {
    expect(findUnsupportedNumbers("-3.2%", [-3.2])).toEqual([]);
    expect(findUnsupportedNumbers("下跌 3.2%", [-3.2])).toEqual([]);
  });

  it("matches units against grounded raw values", () => {
    expect(findUnsupportedNumbers("市值 1.5億", [150_000_000])).toEqual([]);
    expect(findUnsupportedNumbers("市值 150萬", [1_500_000])).toEqual([]);
  });

  it("respects the relative tolerance and the shown precision", () => {
    expect(findUnsupportedNumbers("收 105.5", [105.52])).toEqual([]);
    expect(findUnsupportedNumbers("收 1,235", [1234.5])).toEqual([]);
    expect(findUnsupportedNumbers("收 1000", [1004])).toEqual([]);
    expect(findUnsupportedNumbers("收 1000", [1006])).toEqual(["1000"]);
    expect(findUnsupportedNumbers("收 1000", [1006], { relTolerance: 0.01 })).toEqual([]);
    expect(findUnsupportedNumbers("收 1000", [1004], { relTolerance: 0 })).toEqual(["1000"]);
  });

  it("ignores small counts, ordinals, years and dates", () => {
    expect(findUnsupportedNumbers("3 個情境", [])).toEqual([]);
    expect(findUnsupportedNumbers("第 2 個", [])).toEqual([]);
    expect(findUnsupportedNumbers("第 12 名", [])).toEqual([]);
    expect(findUnsupportedNumbers("2026 年", [])).toEqual([]);
    expect(findUnsupportedNumbers("1990 與 2100 年", [])).toEqual([]);
    expect(findUnsupportedNumbers("2026-10-14 與 10/14", [])).toEqual([]);
  });

  it("still checks a small percentage or decimal", () => {
    expect(findUnsupportedNumbers("漲了 5%", [])).toEqual(["5%"]);
    expect(findUnsupportedNumbers("本益比 8.5", [])).toEqual(["8.5"]);
    expect(findUnsupportedNumbers("共 12 檔", [])).toEqual(["12"]);
  });

  it("reports a repeated mention once, in order, with the original text", () => {
    expect(findUnsupportedNumbers("先 888，再 20%，又 888，又 20%", grounded)).toEqual([
      "888",
      "20%",
    ]);
    expect(findUnsupportedNumbers("市值 １５０萬", [])).toEqual(["１５０萬"]);
  });
});

describe("collectNumbers", () => {
  it("walks nested values and returns every finite number", () => {
    expect(
      collectNumbers({
        a: 1,
        b: [2.5, { c: -3 }],
        d: "x",
        e: null,
        f: true,
        g: Number.NaN,
        h: Number.POSITIVE_INFINITY,
      }),
    ).toEqual([1, 2.5, -3]);
  });

  it("parses numeric strings, including ones embedded in text", () => {
    expect(collectNumbers({ close: "1,234.5", pct: "5.5%", note: "營收 7,000 億" })).toEqual([
      1234.5, 5.5, 700_000_000_000,
    ]);
  });

  it("handles a bare scalar and empty containers", () => {
    expect(collectNumbers(42)).toEqual([42]);
    expect(collectNumbers([])).toEqual([]);
    expect(collectNumbers(undefined)).toEqual([]);
  });
});
