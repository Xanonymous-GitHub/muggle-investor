import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDigest, parseSectorBoard } from "@/sources/darkfanxing";
import { buildDailyFacts, type FactSheet, factSheetFromText } from "./facts";
import {
  checkGrounding,
  extractNumbers,
  findForbiddenPredictions,
  SMALL_INTEGER_MAX,
} from "./grounding";

const fixtures = join(import.meta.dirname, "../../test/fixtures/darkfanxing");
const digest = parseDigest(readFileSync(join(fixtures, "digest-2026-10-08.html"), "utf8"));
const board = parseSectorBoard(readFileSync(join(fixtures, "now-2026-10-08.html"), "utf8"));
const facts = buildDailyFacts(digest, board);

/** Small fact sheet for edge cases; numbers and their written precision come from `text`. */
const sheet = (text = ""): FactSheet => factSheetFromText("2026-10-08", text);

describe("extractNumbers", () => {
  it("reads signed decimals, thousands separators and clock times", () => {
    expect(extractNumbers("力度 -0.63%，成交 10,465.0 億，09:28")).toEqual([-0.63, 10465, 9, 28]);
  });

  it("ignores Chinese numerals by design", () => {
    expect(extractNumbers("三個族群")).toEqual([]);
    expect(extractNumbers("大漲三成，一二三")).toEqual([]);
  });

  it("splits a date into its components; date hyphens are not minus signs", () => {
    expect(extractNumbers("2026-10-08")).toEqual([2026, 10, 8]);
    expect(extractNumbers("2026/10/08")).toEqual([2026, 10, 8]);
  });

  it("treats +, -, − as a sign only directly before a digit and not after a digit", () => {
    expect(extractNumbers("+5.97%")).toEqual([5.97]);
    expect(extractNumbers("−1.24%")).toEqual([-1.24]);
    expect(extractNumbers("漲跌 -619 點")).toEqual([-619]);
    expect(extractNumbers("1-2 檔")).toEqual([1, 2]);
    expect(extractNumbers("5−3")).toEqual([5, 3]);
    expect(extractNumbers("- 3 檔")).toEqual([3]);
    expect(extractNumbers("欣厚-KY")).toEqual([]);
  });

  it("reads thousands separators only as comma + exactly three digits", () => {
    expect(extractNumbers("收 49,349 點")).toEqual([49349]);
    expect(extractNumbers("1,234,567.5")).toEqual([1234567.5]);
    expect(extractNumbers("12,3456")).toEqual([12, 3456]);
    expect(extractNumbers("12,34")).toEqual([12, 34]);
  });

  it("does not treat the full-width comma as a thousands separator", () => {
    expect(extractNumbers("上漲 120，530 檔")).toEqual([120, 530]);
  });

  it("ignores unit suffixes", () => {
    expect(extractNumbers("3 倍、5 家、2 檔、10 億、87 點、4.5%")).toEqual([3, 5, 2, 10, 87, 4.5]);
  });

  it("normalises full-width and other compatibility digits so they cannot slip through", () => {
    expect(extractNumbers("下跌１．２４％")).toEqual([1.24]);
    expect(extractNumbers("－３")).toEqual([-3]);
    expect(extractNumbers("①")).toEqual([1]);
  });

  it("reads decimal digits of other scripts and the Arabic decimal separator", () => {
    expect(extractNumbers("٥٫٣%")).toEqual([5.3]);
    expect(extractNumbers("٠١٢٣٤٥٦٧٨٩")).toEqual([123456789]);
    expect(extractNumbers("१२३٬٤٥٦")).toEqual([123456]);
    expect(extractNumbers("-३")).toEqual([-3]);
  });

  it("does not swallow a sentence-final period or a leading dot", () => {
    expect(extractNumbers("收 49349.")).toEqual([49349]);
    expect(extractNumbers("1.2.3")).toEqual([1.2, 3]);
  });

  it("returns nothing for text without digits", () => {
    expect(extractNumbers("")).toEqual([]);
    expect(extractNumbers("今天資金淨流出")).toEqual([]);
  });
});

describe("checkGrounding", () => {
  it("accepts exact facts and roundings of facts", () => {
    expect(checkGrounding("台指期收 49349 點，下跌 1.2%", facts)).toEqual({
      ok: true,
      ungrounded: [],
    });
  });

  it("rejects a number that is not in the facts", () => {
    expect(checkGrounding("大盤大漲 5.3%", facts)).toEqual({ ok: false, ungrounded: [5.3] });
  });

  it("allows small integers used as ranks and counts", () => {
    expect(checkGrounding("前 3 大族群", facts)).toEqual({ ok: true, ungrounded: [] });
    expect(SMALL_INTEGER_MAX).toBe(20);
    expect(checkGrounding("0 檔、20 檔", sheet("")).ok).toBe(true);
    expect(checkGrounding("21 檔", sheet(""))).toEqual({ ok: false, ungrounded: [21] });
  });

  it("does not extend the small-integer allowance to percentages or decimals", () => {
    expect(checkGrounding("大漲 5%", sheet(""))).toEqual({ ok: false, ungrounded: [5] });
    expect(checkGrounding("大漲 5 %", sheet(""))).toEqual({ ok: false, ungrounded: [5] });
    expect(checkGrounding("3.0 倍", sheet(""))).toEqual({ ok: false, ungrounded: [3] });
  });

  it("accepts the trade date", () => {
    expect(checkGrounding("2026-10-08", facts)).toEqual({ ok: true, ungrounded: [] });
    expect(checkGrounding("2026/10/8", facts).ok).toBe(true);
  });

  it("rejects a clock time that is not in the facts", () => {
    expect(checkGrounding("13:45 收盤", sheet(""))).toEqual({ ok: false, ungrounded: [45] });
  });

  it("compares absolute values, so direction words do not need the sign", () => {
    expect(checkGrounding("下跌 1.24%", sheet("-1.24%")).ok).toBe(true);
    expect(checkGrounding("-0.63%", sheet("0.63%")).ok).toBe(true);
  });

  it("accepts roundings that drop at most one of the fact's written decimal places", () => {
    const f = sheet("1.24、49.13、57.44、1034.4、60.06、49349");
    for (const ok of ["1.24", "1.2", "1.240", "49.1", "57.4", "1034", "60.1", "49349", "49349.0"]) {
      expect(checkGrounding(ok, f)).toEqual({ ok: true, ungrounded: [] });
    }
    // Two places dropped: not a rounding.
    expect(checkGrounding("下跌 1%", f)).toEqual({ ok: false, ungrounded: [1] });
    expect(checkGrounding("49", f)).toEqual({ ok: false, ungrounded: [49] });
    expect(checkGrounding("57 億", f)).toEqual({ ok: false, ungrounded: [57] });
    expect(checkGrounding("60", f)).toEqual({ ok: false, ungrounded: [60] });
    // A fact written as an integer matches only exactly.
    expect(checkGrounding("49350", f)).toEqual({ ok: false, ungrounded: [49350] });
    expect(checkGrounding("1035", f)).toEqual({ ok: false, ungrounded: [1035] });
  });

  it("requires a numeral with at least the fact's precision to equal it", () => {
    const f = sheet("1.24、49.13");
    // 1.20 is written with two decimals; 1.24 rounded to two decimals is 1.24.
    expect(checkGrounding("1.20", f)).toEqual({ ok: false, ungrounded: [1.2] });
    expect(checkGrounding("1.3", f)).toEqual({ ok: false, ungrounded: [1.3] });
    expect(checkGrounding("1.25", f)).toEqual({ ok: false, ungrounded: [1.25] });
    expect(checkGrounding("49.2", f)).toEqual({ ok: false, ungrounded: [49.2] });
  });

  it("still allows a plain small integer even when it is not a rounding", () => {
    // "1" is two places short of 1.24, but a plain count from 0 to 20 is always allowed.
    expect(checkGrounding("1 個", sheet("1.24")).ok).toBe(true);
  });

  it("uses the fewest decimals a value is written with", () => {
    expect(checkGrounding("1", sheet("1.2、1.20")).ok).toBe(true);
    expect(checkGrounding("1%", sheet("1.2%、1.20%")).ok).toBe(true);
    expect(checkGrounding("1%", sheet("1.20%")).ok).toBe(false);
  });

  it("grounds a fact without a recorded precision only exactly", () => {
    const bare: FactSheet = {
      periodKey: "2026-10-08",
      text: "",
      numbers: new Set([1.24]),
      precisions: new Map(),
    };
    expect(checkGrounding("1.24%", bare).ok).toBe(true);
    expect(checkGrounding("1.2%", bare)).toEqual({ ok: false, ungrounded: [1.2] });
  });

  it("accepts either neighbour at an exact rounding tie, despite binary floating point", () => {
    expect(checkGrounding("1.2 與 1.3", sheet("1.25")).ok).toBe(true);
    // 1.005 * 100 is 100.49999999999999 in binary floating point; both 1.00 and 1.01 are valid
    // roundings of the written fact 1.005, so neither may be lost to float noise.
    expect(checkGrounding("1.00 與 1.01", sheet("1.005")).ok).toBe(true);
    expect(checkGrounding("0.28 與 0.29", sheet("0.285")).ok).toBe(true);
    expect(checkGrounding("1.02", sheet("1.005"))).toEqual({ ok: false, ungrounded: [1.02] });
    expect(checkGrounding("1.1", sheet("1.15")).ok).toBe(true);
    expect(checkGrounding("1.0", sheet("1.15"))).toEqual({ ok: false, ungrounded: [1] });
  });

  it("accepts thousands-separated and trailing-zero forms of a fact", () => {
    expect(checkGrounding("成交 10,465.0 億", sheet("10465 億")).ok).toBe(true);
    expect(checkGrounding("收 49,349 點", facts).ok).toBe(true);
  });

  it("applies the precision rule to the real fact sheet", () => {
    for (const ok of ["約 1.2%", "57.4 億", "49349 點", "力度 -0.63%", "1034 億", "60.1 億"]) {
      expect(checkGrounding(ok, facts)).toEqual({ ok: true, ungrounded: [] });
    }
    expect(checkGrounding("被動元件淨流入 104 億", facts)).toEqual({
      ok: false,
      ungrounded: [104],
    });
    expect(checkGrounding("近60日", facts)).toEqual({ ok: false, ungrounded: [60] });
    expect(checkGrounding("台指期下跌 1.3%", facts)).toEqual({ ok: false, ungrounded: [1.3] });
  });

  it("rejects small percentages that no fact supports", () => {
    const f = sheet("台指期 -1.24%、近一月 -4.56%");
    expect(checkGrounding("大漲 5%", f)).toEqual({ ok: false, ungrounded: [5] });
    expect(checkGrounding("台指期下跌 2%", f)).toEqual({ ok: false, ungrounded: [2] });
    expect(checkGrounding("下跌 1%", f)).toEqual({ ok: false, ungrounded: [1] });
  });

  it("cannot reject a value that is itself a fact elsewhere on the sheet (known limitation)", () => {
    // On the real sheet 5 is written in "不織布 3/5" and is a one-place rounding of "近一月 -4.6%",
    // 2 in "近一月 +2%" and "2 檔", 1 in "IC封測 1/24". Number matching cannot tell which subject
    // a value belongs to, so these pass even when attached to the wrong subject.
    expect(checkGrounding("大漲 5%", facts).ok).toBe(true);
    expect(checkGrounding("台指期下跌 2%", facts).ok).toBe(true);
    expect(checkGrounding("下跌 1%", facts).ok).toBe(true);
  });

  it("reports each ungrounded value once, signed, in order of appearance", () => {
    expect(checkGrounding("-7.77%、5.3%、-7.77%、88.8", sheet(""))).toEqual({
      ok: false,
      ungrounded: [-7.77, 5.3, 88.8],
    });
  });

  it("catches full-width and other-script digits", () => {
    expect(checkGrounding("大漲５．３％", facts)).toEqual({ ok: false, ungrounded: [5.3] });
    expect(checkGrounding("大漲 ٥٫٣%", facts)).toEqual({ ok: false, ungrounded: [5.3] });
  });

  it("accepts output with no numbers", () => {
    expect(checkGrounding("", facts)).toEqual({ ok: true, ungrounded: [] });
    expect(checkGrounding("今天資金往被動元件集中。", facts).ok).toBe(true);
  });
});

describe("findForbiddenPredictions", () => {
  it("flags a future time word near a direction word, in either order", () => {
    expect(findForbiddenPredictions("明天大盤可能上漲")).toEqual(["明天大盤可能上漲"]);
    expect(findForbiddenPredictions("預期明日走勢向下")).toEqual(["預期明日"]);
    expect(findForbiddenPredictions("下個交易日可望反彈")).toEqual(["下個交易日可望"]);
  });

  it("does not flag statements about today or a bare future date", () => {
    expect(findForbiddenPredictions("今天資金淨流出")).toEqual([]);
    expect(findForbiddenPredictions("明天是週五")).toEqual([]);
    expect(findForbiddenPredictions("今天大盤下跌，矽晶圓跌幅最大")).toEqual([]);
  });

  it("does not treat the labels 上漲族群／下跌族群 as direction words", () => {
    expect(
      findForbiddenPredictions("上漲族群 87 個、下跌族群 88 個，這些數字只描述今天，不代表明天。"),
    ).toEqual([]);
    expect(findForbiddenPredictions("今天上漲族群比較多，未來可以多留意力度這個指標。")).toEqual(
      [],
    );
    expect(findForbiddenPredictions("明天下跌族群會變多")).toEqual([]);
    expect(findForbiddenPredictions("明天大盤將上漲")).toEqual(["明天大盤將上漲"]);
    expect(findForbiddenPredictions("明天下跌族群會下跌")).toEqual(["明天下跌族群會下跌"]);
    expect(findForbiddenPredictions("下跌族群明天會繼續下跌")).toEqual(["明天會繼續下跌"]);
    expect(findForbiddenPredictions("上漲的族群明天")).toEqual(["上漲的族群明天"]);
  });

  it("flags guarantee words", () => {
    expect(findForbiddenPredictions("穩賺不賠")).toEqual(["穩賺"]);
    for (const word of ["保證", "穩賺", "必漲", "必跌", "一定會漲", "一定會跌"]) {
      expect(findForbiddenPredictions(`這檔${word}`)).toEqual([word]);
    }
  });

  it("covers every time word and direction word", () => {
    const times = ["明天", "明日", "隔天", "下週", "下周", "下個交易日", "未來"];
    const directions = [
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
      "預期",
      "預測",
      "可望",
    ];
    for (const time of times) {
      for (const direction of directions) {
        expect(findForbiddenPredictions(`${time}，${direction}`)).toEqual([
          `${time}，${direction}`,
        ]);
      }
    }
  });

  it("looks across punctuation and line breaks within a 30-character window", () => {
    expect(findForbiddenPredictions("明天，大盤。\n可能上漲")).toEqual(["明天，大盤。\n可能上漲"]);
    expect(findForbiddenPredictions(`明天${"盤".repeat(30)}上漲`)).toHaveLength(1);
    expect(findForbiddenPredictions(`明天${"盤".repeat(31)}上漲`)).toEqual([]);
    expect(findForbiddenPredictions(`上漲${"盤".repeat(31)}明天`)).toEqual([]);
  });

  it("returns every match in order of appearance", () => {
    expect(findForbiddenPredictions("保證獲利。今天平盤。下週將漲")).toEqual(["保證", "下週將漲"]);
  });

  it("finishes quickly on very long input", () => {
    const inputs = [
      "明天".repeat(50_000),
      `明天${"盤".repeat(100_000)}`,
      "明天盤上".repeat(25_000),
      "預期明".repeat(33_000),
    ];
    for (const input of inputs) {
      const start = performance.now();
      findForbiddenPredictions(input);
      expect(performance.now() - start).toBeLessThan(1_000);
    }
  });
});
