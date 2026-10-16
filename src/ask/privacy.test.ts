import { describe, expect, it } from "vitest";
import { argsLeakPrivateData, leakMessage } from "./privacy";

const PRIVATE = [1_500_000, 30_000];

describe("argsLeakPrivateData", () => {
  it("carries the user-facing message verbatim", () => {
    expect(leakMessage).toBe("這個查詢含有你的私人金額，已被攔下；請改用不含金額的查詢。");
  });

  it.each([
    ["plain", "我有 1500000 要投資"],
    ["comma separated", "NT$1,500,000 怎麼配置"],
    ["萬", "150萬放哪裡"],
    ["萬 with a space", "150 萬放哪裡"],
    ["decimal 萬", "150.0萬"],
    ["ASCII w", "150w 怎麼投"],
    ["ASCII M", "1.5M 怎麼投"],
    ["ASCII m", "1.5m 怎麼投"],
    ["full-width digits", "１５０００００"],
    ["full-width digits with separators", "１，５００，０００"],
    ["full-width digits with 萬", "１５０萬"],
    ["plain 30,000", "每月 30000"],
    ["comma 30,000", "每月 30,000"],
    ["3萬", "每月 3萬"],
    ["3w", "每月 3w"],
    ["30k", "每月 30k"],
  ])("blocks %s", (_label, q) => {
    expect(argsLeakPrivateData({ q }, PRIVATE)).toBe(true);
  });

  it("expands 億 and 億+萬 forms", () => {
    expect(argsLeakPrivateData("1.5億", [150_000_000])).toBe(true);
    expect(argsLeakPrivateData("1億5000萬", [150_000_000])).toBe(true);
    expect(argsLeakPrivateData("1.5億", [1_500_000])).toBe(false);
  });

  describe("written-out forms (fix round 1)", () => {
    it.each([
      ["1.5 million"],
      ["1.5mn"],
      ["1.5 M"],
      ["30 k"],
      ["1.5 Million"],
      ["一百五十萬"],
      ["三萬"],
      ["1.5百萬"],
      ["1,500千元"],
      ["1 500 000"],
      ["1\u00a0500\u00a0000"],
      ["1\u2009500\u2009000"],
      ["1\u202f500\u202f000"],
      ["1.5e6"],
      ["1.5E6"],
      ["3e4"],
      ["15,00,000"],
      ["NT$1,500,000"],
      ["150萬元"],
      ["1500000.00"],
      ["1,500,000元"],
      ["$1.5m"],
      ["1500k"],
      ["1 500 000元"],
      ["30 000"],
    ])("blocks %s", (q) => {
      expect(argsLeakPrivateData({ q }, PRIVATE)).toBe(true);
    });

    it("blocks Chinese numerals by value", () => {
      expect(argsLeakPrivateData("兩百萬", [2_000_000])).toBe(true);
      expect(argsLeakPrivateData("一千五百萬", [15_000_000])).toBe(true);
      expect(argsLeakPrivateData("一億五千萬", [150_000_000])).toBe(true);
      expect(argsLeakPrivateData("二〇二六萬", [20_260_000])).toBe(false);
      expect(argsLeakPrivateData("一千五百萬", PRIVATE)).toBe(false);
    });

    it("blocks the 億+萬 mix", () => {
      expect(argsLeakPrivateData("1億5000萬", [150_000_000])).toBe(true);
      expect(argsLeakPrivateData("1萬5000", [15_000])).toBe(true);
      expect(argsLeakPrivateData("5千萬", [50_000_000])).toBe(true);
    });

    it("blocks an amount in object keys and numeric leaves", () => {
      expect(argsLeakPrivateData({ "1500000": 1 }, PRIVATE)).toBe(true);
      expect(argsLeakPrivateData({ "1500000": 1 }, [1_000_000])).toBe(false);
    });

    it("keeps false positives low", () => {
      expect(argsLeakPrivateData("台積電 2330 法說會 2026", [600_000, 15_000])).toBe(false);
      expect(argsLeakPrivateData("1 500", PRIVATE)).toBe(false);
      expect(argsLeakPrivateData("1 5000 000", PRIVATE)).toBe(false);
      expect(argsLeakPrivateData("1.5 mm 30 kg", PRIVATE)).toBe(false);
      expect(argsLeakPrivateData("一百五十", PRIVATE)).toBe(false);
      expect(argsLeakPrivateData("15,000", [1_500_000])).toBe(false);
    });

    it("stays fast on a 100 KB string", () => {
      const size = 100_000;
      const probes = [
        "1234567890".repeat(size / 10),
        "1,234,".repeat(size / 6),
        "1 ".repeat(size / 2),
        "1億".repeat(size / 2),
        "1 234 ".repeat(size / 6),
        "一千".repeat(size / 2),
        "9e".repeat(size / 2),
      ];
      const t0 = performance.now();
      for (const probe of probes) argsLeakPrivateData({ q: probe }, PRIVATE);
      expect(performance.now() - t0).toBeLessThan(1000);
    });
  });

  it("blocks a bare numeric leaf", () => {
    expect(argsLeakPrivateData({ amount: 1_500_000 }, PRIVATE)).toBe(true);
    expect(argsLeakPrivateData([30_000], PRIVATE)).toBe(true);
  });

  it("lets an ordinary query through", () => {
    expect(argsLeakPrivateData({ q: "台積電 2330 法說會 2026" }, [600_000, 15_000])).toBe(false);
  });

  it("matches only on equality after unit expansion", () => {
    expect(argsLeakPrivateData("150萬", [1_500_000])).toBe(true);
    expect(argsLeakPrivateData("150萬", [1_000_000])).toBe(false);
    expect(argsLeakPrivateData("1,500,001", PRIVATE)).toBe(false);
    expect(argsLeakPrivateData("15000000", PRIVATE)).toBe(false);
  });

  it("walks nested arrays and objects", () => {
    expect(argsLeakPrivateData({ q: ["x", { n: "1,500,000" }] }, PRIVATE)).toBe(true);
    expect(argsLeakPrivateData([[[{ deep: { er: 30_000 } }]]], PRIVATE)).toBe(true);
    expect(argsLeakPrivateData({ q: ["x", { n: "1,500,001" }] }, PRIVATE)).toBe(false);
  });

  it("ignores non-string, non-number leaves", () => {
    expect(argsLeakPrivateData({ a: null, b: true, c: undefined, d: false }, PRIVATE)).toBe(false);
    expect(argsLeakPrivateData(null, PRIVATE)).toBe(false);
    expect(argsLeakPrivateData(undefined, PRIVATE)).toBe(false);
  });

  it("never blocks when there are no private numbers", () => {
    expect(argsLeakPrivateData({ q: "1,500,000 150萬 30000" }, [])).toBe(false);
  });

  it("fails closed on absurdly deep input instead of recursing forever", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 200; i++) deep = [deep];
    expect(argsLeakPrivateData(deep, PRIVATE)).toBe(true);
  });

  describe("R-A1: private numbers below 1000 are ignored", () => {
    it("a private 10 never blocks ordinary arguments", () => {
      expect(argsLeakPrivateData({ limit: 10 }, [10])).toBe(false);
      expect(argsLeakPrivateData({ q: "top 10", limit: "10" }, [10, 999])).toBe(false);
      expect(argsLeakPrivateData({ n: 999 }, [999])).toBe(false);
    });

    it("a private 1000 blocks 1000 and 1,000", () => {
      expect(argsLeakPrivateData({ limit: 1000 }, [1000])).toBe(true);
      expect(argsLeakPrivateData({ q: "1000" }, [1000])).toBe(true);
      expect(argsLeakPrivateData({ q: "1,000" }, [1000])).toBe(true);
    });

    it("a small private number does not mask a large one in the same list", () => {
      expect(argsLeakPrivateData({ limit: 10, q: "30,000" }, [10, 30_000])).toBe(true);
    });
  });
});
