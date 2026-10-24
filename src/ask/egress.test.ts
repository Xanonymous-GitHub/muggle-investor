import { describe, expect, it } from "vitest";
import {
  DEFAULT_EGRESS_POLICY,
  type EgressPolicy,
  type PrivateContext,
  screenEgress,
  sensitiveFromChat,
  sharesRun,
  squash,
} from "./egress";

const ctx = (over: Partial<PrivateContext> = {}): PrivateContext => ({
  numbers: [],
  texts: [],
  ...over,
});
const reasonOf = (
  args: unknown,
  context: PrivateContext = ctx(),
  policy: EgressPolicy = DEFAULT_EGRESS_POLICY,
) => {
  const verdict = screenEgress(args, context, policy);
  return verdict.ok ? "ok" : verdict.reason;
};

describe("screenEgress: what may leave", () => {
  it("lets a public symbol or topic query through", () => {
    expect(reasonOf({ query: "0050 ETF 殖利率" })).toBe("ok");
    expect(reasonOf({ query: "台積電 法說會", limit: 5 })).toBe("ok");
    expect(reasonOf({ symbols: ["0050", "0056"] })).toBe("ok");
  });

  it("refuses arguments that are not a small plain object", () => {
    expect(reasonOf({ " bad key": "x" })).toBe("invalid_shape");
    expect(reasonOf({ a: { b: { c: { d: "x" } } } })).toBe("invalid_shape");
    expect(reasonOf(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, "x"])))).toBe(
      "oversize",
    );
    expect(reasonOf({ list: Array.from({ length: 11 }, () => "x") })).toBe("oversize");
    expect(reasonOf({ query: "字".repeat(201) })).toBe("oversize");
    expect(reasonOf({ a: "字".repeat(150), b: "字".repeat(150), c: "字".repeat(150) })).toBe(
      "oversize",
    );
  });

  describe("tool modes", () => {
    it("symbol: only ticker-shaped values", () => {
      const policy: EgressPolicy = { mode: "symbol", maxChars: 10 };
      expect(reasonOf({ symbol: "0050" }, ctx(), policy)).toBe("ok");
      expect(reasonOf({ symbol: "00679B" }, ctx(), policy)).toBe("ok");
      expect(reasonOf({ symbol: "我的退休金" }, ctx(), policy)).toBe("not_public");
      expect(reasonOf({ symbol: "0050 x" }, ctx(), policy)).toBe("not_public");
      expect(reasonOf({ symbol: "0050 and more" }, ctx(), policy)).toBe("oversize");
    });

    it("topic: a short noun phrase, not a sentence", () => {
      const policy: EgressPolicy = { mode: "topic", maxChars: 60 };
      expect(reasonOf({ topic: "半導體 供應鏈" }, ctx(), policy)).toBe("ok");
      expect(reasonOf({ topic: "我想知道台積電怎麼了。請告訴我。" }, ctx(), policy)).toBe(
        "not_public",
      );
      expect(reasonOf({ topic: "a b c d e f g h i" }, ctx(), policy)).toBe("not_public");
      expect(reasonOf({ topic: "x".repeat(61) }, ctx(), policy)).toBe("oversize");
    });

    it("free_text honours the tool's own length limit", () => {
      expect(reasonOf({ query: "字".repeat(30) }, ctx(), { mode: "free_text", maxChars: 20 })).toBe(
        "oversize",
      );
    });
  });

  describe("private numbers", () => {
    it("blocks an amount in any common spelling, including small ones", () => {
      const context = ctx({ numbers: [500, 1_500_000] });
      expect(reasonOf({ query: "我有 150 萬" }, context)).toBe("private_number");
      expect(reasonOf({ query: "1,500,000" }, context)).toBe("private_number");
      expect(reasonOf({ query: "持有 500 股" }, context)).toBe("private_number");
      expect(reasonOf({ amount: 500 }, context)).toBe("private_number");
    });

    it("does not block a paging control that equals a small private number", () => {
      const context = ctx({ numbers: [100] });
      expect(reasonOf({ query: "0050 news", limit: 100 }, context)).toBe("ok");
      expect(reasonOf({ query: "0050 news", max_results: 100 }, context)).toBe("ok");
      expect(reasonOf({ query: "news 100" }, context)).toBe("private_number");
      expect(reasonOf({ limit: "100" }, context)).toBe("private_number");
    });

    it("does not let a private amount leave under a paging key", () => {
      const context = ctx({ numbers: [500_000, 1500] });
      expect(reasonOf({ query: "0050 news", limit: 500_000 }, context)).toBe("private_number");
      expect(reasonOf({ query: "0050 news", max_results: 1500 }, context)).toBe("private_number");
      expect(reasonOf({ query: "0050 news", limit: 10 }, context)).toBe("ok");
    });

    it("still ignores a private number below the floor", () => {
      expect(reasonOf({ query: "top 30" }, ctx({ numbers: [30] }))).toBe("ok");
    });

    it("reads the live list at call time", () => {
      const numbers: number[] = [];
      const context = ctx({ numbers });
      expect(reasonOf({ q: "2,400,000" }, context)).toBe("ok");
      numbers.push(2_400_000);
      expect(reasonOf({ q: "2,400,000" }, context)).toBe("private_number");
    });
  });

  describe("private text", () => {
    const NOTE = "我兩年內想買房，所以不能承受太大的虧損";

    it("blocks a run copied from a saved note", () => {
      expect(reasonOf({ query: "兩年內想買房 ETF" }, ctx({ texts: [NOTE] }))).toBe("private_text");
      expect(reasonOf({ query: "不能承受太大的虧損 怎麼配置" }, ctx({ texts: [NOTE] }))).toBe(
        "private_text",
      );
    });

    it("lets a few shared words through: only a long copied run is a leak", () => {
      expect(reasonOf({ query: "買房 ETF 比較" }, ctx({ texts: [NOTE] }))).toBe("ok");
    });

    it("blocks a short note when all of it appears", () => {
      expect(reasonOf({ query: "ETF 無債務" }, ctx({ texts: ["無債務"] }))).toBe("ok");
      expect(reasonOf({ query: "ETF 無債務壓力" }, ctx({ texts: ["無債務壓力"] }))).toBe(
        "private_text",
      );
    });

    it("sees through case, width, spacing and zero-width characters", () => {
      const context = ctx({ texts: ["Retire at fifty-five with a pension"] });
      expect(reasonOf({ query: "retire at fifty five w/ pension" }, context)).toBe("private_text");
      expect(reasonOf({ query: "ＲＥＴＩＲＥ  ａｔ​ fifty-five" }, context)).toBe("private_text");
    });

    it("does not count a holding's symbol as private when it sits in a note", () => {
      const context = ctx({
        texts: ["我持有 2330 長期投資"],
        publicSymbols: new Set(["2330"]),
      });
      expect(reasonOf({ query: "2330 新聞" }, context)).toBe("ok");
      expect(reasonOf({ query: "長期投資 我持有 2330" }, context)).toBe("ok");
    });
  });

  describe("personal identifiers", () => {
    it.each([
      ["an email", "寄到 me@example.com"],
      ["a mobile number", "0912-345-678"],
      ["a national ID", "A123456789"],
      ["a card number", "4111 1111 1111 1111"],
      ["an account number", "帳號 1234567890123"],
    ])("blocks %s whatever its origin", (_label, query) => {
      expect(reasonOf({ query })).toBe("pii");
    });

    it("lets ordinary digits through", () => {
      expect(reasonOf({ query: "0050 2026 年配息 1.2 元" })).toBe("ok");
    });
  });
});

describe("sharesRun", () => {
  it("compares squashed text and ignores public symbols", () => {
    expect(squash("Ａ-b，c 　D")).toBe("abcd");
    expect(sharesRun("abc", "abc")).toBe(false);
    expect(sharesRun("兩年內想買房", "我兩年內想買房")).toBe(true);
  });
});

describe("sensitiveFromChat", () => {
  it("takes the amounts written beside a money word", () => {
    const { numbers } = sensitiveFromChat([
      { role: "user", content: "我的存款有 200 萬，月薪 65000。" },
      { role: "assistant", content: "你的存款 999999 元" },
    ]);
    expect(numbers).toEqual([2_000_000, 65_000]);
  });

  it("takes first-person sentences about money, work, health or family", () => {
    const { texts } = sensitiveFromChat([
      {
        role: "user",
        content: "我最近被診斷出癌症需要一筆醫療費。台積電最近怎麼了？我老婆在公司被裁員",
      },
    ]);
    expect(texts).toEqual(["我最近被診斷出癌症需要一筆醫療費", "我老婆在公司被裁員"]);
  });

  it("leaves public questions alone", () => {
    expect(
      sensitiveFromChat([{ role: "user", content: "我想知道 0050 跟 0056 差在哪？指數 22000 點" }]),
    ).toEqual({ numbers: [], texts: [] });
  });
});
