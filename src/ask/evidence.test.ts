import { describe, expect, it } from "vitest";
import {
  EvidenceLedger,
  MAX_FACTS_PER_SOURCE,
  MAX_FACTS_TOTAL,
  MAX_RECORDS,
  normalizeUrl,
  unitOfMetric,
  urlsIn,
} from "./evidence";

const NOW = new Date("2026-10-08T08:00:00Z");

describe("EvidenceLedger freshness warnings", () => {
  it("does not blame a source with no figures for the sessions of the sources before it", () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({
      tool: "getInstrumentHistory",
      kind: "internal",
      result: { dataDate: "2026-10-07", session: "closed", rows: [{ close: 101.5 }] },
    });
    ledger.record({
      tool: "getSectorBoard",
      kind: "internal",
      result: { dataDate: "2026-10-08", session: "intraday", rows: [{ close: 202.5 }] },
    });
    const term = ledger.record({
      tool: "lookupTerm",
      kind: "internal",
      result: { term: "殖利率", definition: "股息除以股價" },
    });
    expect(term.warnings).not.toContain("mixed_session");
  });

  it("still warns when one result mixes sessions", () => {
    const ledger = new EvidenceLedger(NOW);
    const source = ledger.record({
      tool: "getMarketToday",
      kind: "internal",
      result: {
        digest: { session: "closed", dataDate: "2026-10-07", rows: [{ close: 1.5 }] },
        board: { session: "intraday", dataDate: "2026-10-08", rows: [{ close: 2.5 }] },
      },
    });
    expect(source.warnings).toContain("mixed_session");
  });
});

describe("EvidenceLedger", () => {
  it("records a source with its retrieval time, data date, as-of and session", () => {
    const ledger = new EvidenceLedger(NOW);
    const source = ledger.record({
      tool: "getSectorBoard",
      kind: "internal",
      result: { dataDate: "2026-10-08", asOf: "2026-10-08T05:30:00Z", session: "intraday" },
    });
    expect(source).toMatchObject({
      id: "s1",
      tool: "getSectorBoard",
      kind: "internal",
      retrievedAt: NOW.toISOString(),
      dataDate: "2026-10-08",
      asOf: "2026-10-08T05:30:00Z",
      session: "intraday",
      failed: false,
      truncated: false,
    });
  });

  it("binds each number to its subject, metric, unit and nearest data date", () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({
      tool: "getMarketToday",
      kind: "internal",
      result: {
        dataDate: "2026-10-07",
        session: "closed",
        market: { breadth: 1.8 },
        board: {
          dataDate: "2026-10-08",
          session: "intraday",
          sectors: [{ name: "半導體業", changePct: -1.5, rank: 3 }],
        },
      },
    });
    const breadth = ledger.facts.find((fact) => fact.metric === "breadth");
    expect(breadth).toMatchObject({ value: 1.8, dataDate: "2026-10-07", subjects: [] });
    const change = ledger.facts.find((fact) => fact.metric === "changePct");
    expect(change).toMatchObject({
      value: -1.5,
      unit: "percent",
      dataDate: "2026-10-08",
      subjects: ["半導體業"],
    });
    expect(ledger.facts.find((fact) => fact.metric === "rank")?.unit).toBe("count");
  });

  it("marks an error result as a failed source with no facts", () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({ tool: "getMyPlan", kind: "internal", result: { error: "no_plan" } });
    expect(ledger.sources[0]?.failed).toBe(true);
    expect(ledger.facts).toEqual([]);
    expect(ledger.groups()).toEqual([]);
    expect(ledger.summary()).toMatchObject({
      sources: 0,
      failed: ["getMyPlan"],
      truncated: false,
      warnings: [],
    });
  });

  it("lists each source as a record with its own metadata, failed ones included", () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({
      tool: "getMarketToday",
      kind: "internal",
      result: { dataDate: "2026-10-06", session: "closed", stale: true, x: 1 },
    });
    ledger.record({ tool: "search__web", kind: "external", result: { error: "timeout" } });
    expect(ledger.summary().records).toEqual([
      {
        id: "s1",
        tool: "getMarketToday",
        kind: "internal",
        retrievedAt: NOW.toISOString(),
        dataDate: "2026-10-06",
        asOf: null,
        session: "closed",
        urls: [],
        truncated: false,
        failed: false,
        warnings: ["stale"],
      },
      expect.objectContaining({ id: "s2", tool: "search__web", kind: "external", failed: true }),
    ]);
    expect(ledger.summary().omitted).toBe(0);
  });

  it("bounds the records and the urls of each, and counts what it left out", () => {
    const ledger = new EvidenceLedger(NOW);
    const urls = Array.from({ length: 9 }, (_, i) => `https://a.example/p${i}`).join(" ");
    for (let i = 0; i < MAX_RECORDS + 3; i++) {
      ledger.record({ tool: `t${i}`, kind: "internal", result: { note: urls, n: i } });
    }
    const summary = ledger.summary();
    expect(summary.records).toHaveLength(MAX_RECORDS);
    expect(summary.records?.[0]?.urls).toHaveLength(5);
    expect(summary.omitted).toBe(3);
    expect(summary.sources).toBe(MAX_RECORDS + 3);
  });

  it("carries the stale and truncated flags of a result into the summary", () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({
      tool: "getMarketToday",
      kind: "internal",
      result: { dataDate: "2026-10-06", stale: true, truncated: true, x: 1 },
    });
    expect(ledger.summary()).toMatchObject({ truncated: true, warnings: ["stale"] });
  });

  it("keeps at most MAX_FACTS_PER_SOURCE facts of one result and marks it truncated", () => {
    const ledger = new EvidenceLedger(NOW);
    const rows = Array.from({ length: 150 }, (_, i) => ({
      name: `n${i}`,
      a: i,
      b: i,
      c: i,
      d: i,
      e: i,
      f: i,
      g: i,
      h: i,
      i,
      j: i,
      k: i,
    }));
    const source = ledger.record({ tool: "t", kind: "internal", result: { rows } });
    expect(ledger.facts.length).toBe(MAX_FACTS_PER_SOURCE);
    expect(source.truncated).toBe(true);
  });

  it("bounds the whole run to MAX_FACTS_TOTAL facts", () => {
    const ledger = new EvidenceLedger(NOW);
    for (let k = 0; k < 8; k++) {
      ledger.record({
        tool: "t",
        kind: "internal",
        result: { v: Array.from({ length: 200 }, (_, i) => i + k * 1000) },
      });
    }
    ledger.record({ tool: "t", kind: "internal", result: { text: "1 2 3 ".repeat(2000) } });
    expect(ledger.facts.length).toBeLessThanOrEqual(MAX_FACTS_TOTAL);
  });

  it("reads numbers written inside strings, with their percent unit", () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({
      tool: "search__web_search",
      kind: "external",
      result: { source: "search", untrusted: true, content: "台積電收盤 1,050 元，上漲 2.5%" },
    });
    expect(ledger.facts.map((f) => [f.value, f.unit])).toEqual([
      [1050, "other"],
      [2.5, "percent"],
    ]);
  });

  it("collects the URLs of a result, normalized, and nothing else", () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({
      tool: "search__web_search",
      kind: "external",
      result: {
        content: "見 https://www.Example.com/news/1/?utm_source=x#top 與 (https://b.example/a)。",
      },
    });
    expect([...ledger.urls()].sort()).toEqual(["b.example/a", "example.com/news/1"]);
    expect(ledger.sources[0]?.urls.sort()).toEqual(["b.example/a", "example.com/news/1"]);
  });

  it("lists subjects longest first, without one-character names", () => {
    const ledger = new EvidenceLedger(NOW);
    ledger.record({
      tool: "t",
      kind: "internal",
      result: {
        rows: [
          { symbol: "0050", name: "元大台灣50", v: 1 },
          { symbol: "X", v: 2 },
        ],
      },
    });
    expect(ledger.subjects()).toEqual(["元大台灣50", "0050"]);
  });
});

describe("normalizeUrl", () => {
  it.each([
    ["https://www.example.com/a/", "example.com/a"],
    ["http://EXAMPLE.com/a?utm_medium=x&id=3", "example.com/a?id=3"],
    ["https://example.com/a#frag", "example.com/a"],
    ["https://example.com/a.", "example.com/a"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeUrl(raw)).toBe(expected);
  });

  it.each(["javascript:alert(1)", "ftp://x.test/a", "https://u:p@x.test/a", "not a url", ""])(
    "rejects %j",
    (raw) => {
      expect(normalizeUrl(raw)).toBeNull();
    },
  );

  it("finds every URL in a text, markdown links included", () => {
    expect(urlsIn("[路透](https://reuters.example/a) 與 https://b.example/x/。")).toEqual([
      "reuters.example/a",
      "b.example/x",
    ]);
  });
});

describe("unitOfMetric", () => {
  it.each([
    ["changePct", "percent"],
    ["return1yPct", "percent"],
    ["lastClose", "amount"],
    ["marketTurnover", "amount"],
    ["barCount", "count"],
    ["breadth", "other"],
  ])("%s is %s", (metric, unit) => {
    expect(unitOfMetric(metric)).toBe(unit);
  });
});
