import { describe, expect, it } from "vitest";
import {
  parseCount,
  parseMovers,
  parseNumber,
  parsePair,
  parseRocDate,
  parseStockLabel,
  parseTriple,
} from "./parse-values";

describe("parseNumber", () => {
  it("parses signed, comma and percent forms", () => {
    expect(parseNumber("+5.97")).toBe(5.97);
    expect(parseNumber("-619")).toBe(-619);
    expect(parseNumber("−619")).toBe(-619);
    expect(parseNumber("10,465.0")).toBe(10465);
    expect(parseNumber(" 3.2% ")).toBe(3.2);
  });
  it("returns null for empty markers", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("—")).toBeNull();
    expect(parseNumber("-")).toBeNull();
    expect(parseNumber("無成交")).toBeNull();
  });
  it("throws on garbage", () => {
    expect(() => parseNumber("abc")).toThrow(/abc/);
  });
});

describe("parseCount", () => {
  it("defaults empty to 0", () => {
    expect(parseCount("")).toBe(0);
    expect(parseCount("12")).toBe(12);
    expect(parseCount("—")).toBe(0);
  });
});

describe("parseTriple / parsePair", () => {
  it("splits slash-separated numbers", () => {
    expect(parseTriple("4/1/0")).toEqual([4, 1, 0]);
    expect(parsePair("69/101")).toEqual([69, 101]);
  });
  it("throws on malformed input", () => {
    expect(() => parseTriple("abc")).toThrow(/abc/);
    expect(() => parsePair("1/2/3")).toThrow(/1\/2\/3/);
  });
});

describe("parseRocDate", () => {
  it("converts ROC dates to ISO", () => {
    expect(parseRocDate("115/09/01")).toBe("2026-09-01");
    expect(parseRocDate("1150101")).toBe("2026-01-01");
  });
  it("throws on malformed input", () => {
    expect(() => parseRocDate("x")).toThrow(/x/);
  });
});

describe("parseStockLabel", () => {
  it("splits name and code", () => {
    expect(parseStockLabel("安碁 6174")).toEqual({ name: "安碁", code: "6174" });
    expect(parseStockLabel("騰輝電子-KY 6672")).toEqual({ name: "騰輝電子-KY", code: "6672" });
    expect(parseStockLabel("太景*-KY 4157")).toEqual({ name: "太景*-KY", code: "4157" });
  });
  it("throws without a code", () => {
    expect(() => parseStockLabel("安碁")).toThrow(/安碁/);
  });
});

describe("parseMovers", () => {
  it("parses names containing full-width punctuation", () => {
    expect(parseMovers("染料，顏料 +4.3、不織布 +3.5、體外／科研檢測試紙器材 -2.3")).toEqual([
      { name: "染料，顏料", changePct: 4.3 },
      { name: "不織布", changePct: 3.5 },
      { name: "體外／科研檢測試紙器材", changePct: -2.3 },
    ]);
  });
  it("returns [] for empty", () => {
    expect(parseMovers("")).toEqual([]);
  });
});
