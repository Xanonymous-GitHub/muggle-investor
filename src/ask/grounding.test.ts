import { describe, expect, it } from "vitest";
import type { AskRequest } from "@/ask/schema";
import { EvidenceLedger } from "./evidence";
import { verifyAnswer } from "./grounding";

const NOW = new Date("2026-10-08T08:00:00Z");

const history = (symbol: string, name: string, over: Record<string, unknown> = {}) => ({
  symbol,
  name,
  dataDate: "2026-10-07",
  lastClose: 187.35,
  return1mPct: 2.4,
  return1yPct: 21.4,
  maxDrawdownPct: -33.5,
  ...over,
});

function ledgerOf(...results: Record<string, unknown>[]): EvidenceLedger {
  const ledger = new EvidenceLedger(NOW);
  for (const result of results) {
    ledger.record({ tool: "getInstrumentHistory", kind: "internal", result });
  }
  return ledger;
}

const request = (
  messages: AskRequest["messages"] = [{ role: "user", content: "比較一下" }],
  profile: AskRequest["profile"] = { holdings: [], memory: [] },
): Pick<AskRequest, "messages" | "profile"> => ({ messages, profile });

const verify = (text: string, ledger: EvidenceLedger, req = request()) =>
  verifyAnswer({ text, request: req, ledger });

const ETFS = () =>
  ledgerOf(
    history("0050", "元大台灣50"),
    history("0056", "元大高股息", { lastClose: 36.8, return1yPct: 8.2, maxDrawdownPct: -18.4 }),
  );

describe("verifyAnswer: evidence binding", () => {
  it("finds nothing wrong with a figure that matches its instrument, metric, unit and date", () => {
    const v = verify("0050 近一年報酬 21.4%，收盤價 187.35 元（2026-10-07）。", ETFS());
    expect(v.issues).toEqual([]);
    expect(v.unsupported).toEqual([]);
    expect(v.checked).toBe(true);
  });

  it("flags a correct number attached to the wrong instrument", () => {
    const v = verify("0056 近一年報酬 21.4%。", ETFS());
    expect(v.issues).toEqual([{ figure: "21.4%", kind: "subject" }]);
    expect(v.unsupported).toEqual(["21.4%"]);
  });

  it("flags a correct number attached to the wrong metric", () => {
    // -33.5 is 0050's maximum drawdown, not its one-year return.
    const v = verify("0050 近一年報酬 -33.5%。", ETFS());
    expect(v.issues).toEqual([{ figure: "-33.5%", kind: "metric" }]);
  });

  it("accepts the same number under the metric it belongs to", () => {
    expect(verify("0050 最大回撤 -33.5%。", ETFS()).issues).toEqual([]);
    expect(verify("0050 最大回撤 33.5%。", ETFS()).issues).toEqual([]);
  });

  it("flags a fall written as a rise and a rise written as a fall", () => {
    const ledger = ledgerOf(history("0050", "元大台灣50", { return1mPct: -3.2 }));
    expect(verify("0050 近一個月上漲 3.2%。", ledger).issues).toEqual([
      { figure: "3.2%", kind: "sign" },
    ]);
    expect(verify("0050 近一個月下跌 3.2%。", ledger).issues).toEqual([]);
    expect(verify("0050 近一年下跌 21.4%。", ETFS()).issues).toEqual([
      { figure: "21.4%", kind: "sign" },
    ]);
    expect(verify("0050 近一年上漲 21.4%。", ETFS()).issues).toEqual([]);
  });

  it("flags a percentage read off an amount and an amount read off a percentage", () => {
    expect(verify("0050 收盤價 187.35%。", ETFS()).issues).toEqual([
      { figure: "187.35%", kind: "unit" },
    ]);
    expect(verify("0050 近一年報酬 21.4 元。", ETFS()).issues).toEqual([
      { figure: "21.4", kind: "unit" },
    ]);
  });

  it("flags a figure dated differently from the data that holds it", () => {
    expect(verify("0050 收盤 187.35 元（10/6）。", ETFS()).issues).toEqual([
      { figure: "187.35", kind: "date" },
    ]);
    expect(verify("0050 收盤 187.35 元（10/7）。", ETFS()).issues).toEqual([]);
    expect(verify("0050 在 2025-10-07 收盤 187.35 元。", ETFS()).issues).toEqual([
      { figure: "187.35", kind: "date" },
    ]);
  });

  it("keeps a line that names no known instrument or date out of the binding checks", () => {
    expect(verify("近一年報酬 21.4%。", ETFS()).issues).toEqual([]);
  });

  it("flags a number no evidence carries, and says nothing about derived ones", () => {
    const v = verify("0050 近一年報酬 99.9%，收盤價 187.35 元。", ETFS());
    expect(v.unsupported).toEqual(["99.9%"]);
    expect(v.issues).toEqual([{ figure: "99.9%", kind: "unsupported" }]);
  });

  it("accepts a percent change derived from two values of the same source", () => {
    const ledger = ledgerOf({ symbol: "0050", dataDate: "2026-10-07", open: 180, close: 189 });
    expect(verify("0050 從 180 到 189，變動 5%。", ledger).issues).toEqual([]);
  });

  it("never lets an empty issue list stand for verified facts: it reports what evidence it had", () => {
    const v = verify("市場看起來很強。", new EvidenceLedger(NOW));
    expect(v.issues).toEqual([]);
    expect(v.evidence).toMatchObject({
      sources: 0,
      failed: [],
      truncated: false,
      warnings: [],
      records: [],
      omitted: 0,
    });
  });

  it("reports truncation, staleness and sources that returned nothing", () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({
      tool: "getMarketToday",
      kind: "internal",
      result: { dataDate: "2026-10-06", stale: true, truncated: true, breadth: 1.2 },
    });
    ledger.record({ tool: "getMyPlan", kind: "internal", result: { error: "no_plan" } });
    expect(verify("好的。", ledger).evidence).toMatchObject({
      sources: 1,
      failed: ["getMyPlan"],
      truncated: true,
      warnings: ["stale"],
    });
  });
});

describe("verifyAnswer: whose words ground a figure", () => {
  const empty = () => new EvidenceLedger(NOW);

  it("never grounds a figure on an earlier assistant message", () => {
    const v = verify(
      "0050 目前 187.35 元。",
      empty(),
      request([
        { role: "user", content: "0050 現在多少？" },
        { role: "assistant", content: "0050 目前 187.35 元。" },
        { role: "user", content: "再說一次" },
      ]),
    );
    expect(v.issues).toEqual([{ figure: "187.35", kind: "history_only" }]);
  });

  it("reports a number the user stated as their assertion, not as market evidence", () => {
    const v = verify(
      "你說 0050 現在 250 元。",
      empty(),
      request([{ role: "user", content: "聽說 0050 現在 250 元" }]),
    );
    expect(v.userStated).toEqual(["250"]);
    expect(v.unsupported).toEqual([]);
  });

  it("prefers the run's evidence over the user's claim when both state it", () => {
    const ledger = ledgerOf(history("0050", "元大台灣50", { lastClose: 187.35 }));
    const v = verify(
      "0050 收盤 187.35 元。",
      ledger,
      request([{ role: "user", content: "0050 是不是 187.35 元？" }]),
    );
    expect(v.userStated).toEqual([]);
    expect(v.issues).toEqual([]);
  });

  it("does not report a ticker code the user typed as a figure they assert", () => {
    const v = verify(
      "0050 與 2330 都是常見的標的。",
      empty(),
      request([{ role: "user", content: "我想買 0050 和 2330" }]),
    );
    expect(v.userStated).toEqual([]);
  });

  it("accepts the profile's own figures without listing them", () => {
    const v = verify(
      "你的 0050 部位 345678 元。",
      empty(),
      request([{ role: "user", content: "我的部位如何？" }], {
        holdings: [{ symbol: "0050", amount: 345_678 }],
        memory: [],
      }),
    );
    expect(v.unsupported).toEqual([]);
    expect(v.userStated).toEqual([]);
  });
});

describe("verifyAnswer: links", () => {
  const withNews = () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({
      tool: "search__web_search",
      kind: "external",
      result: { content: "https://news.example.com/a/1 台積電法說會" },
    });
    return ledger;
  };

  it("accepts a link a tool result of this run contained, whatever its tracking parameters", () => {
    const v = verify("來源：[新聞](https://www.news.example.com/a/1/?utm_source=x)", withNews());
    expect(v.unverifiedLinks).toEqual([]);
  });

  it("does not count a plausible link the model made up as a source", () => {
    const v = verify(
      "來源：[新聞](https://news.example.com/a/2) 與 https://invented.example/report",
      withNews(),
    );
    expect(v.unverifiedLinks).toEqual(["news.example.com/a/2", "invented.example/report"]);
  });

  it("treats every link as unverified when no tool returned one", () => {
    const v = verify("見 https://x.example/a", new EvidenceLedger(NOW));
    expect(v.unverifiedLinks).toEqual(["x.example/a"]);
  });
});
