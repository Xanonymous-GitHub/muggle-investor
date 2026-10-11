import { describe, expect, it } from "vitest";
import { parseTitle } from "./parse-title";
import { DarkfanxingParseError } from "./schemas";

describe("parseTitle", () => {
  it("reads date, time and closed session", () => {
    expect(parseTitle("台股族群即時狀態 2026-10-08 13:34（收盤後）")).toEqual({
      tradeDate: "2026-10-08",
      asOf: "13:34",
      session: "closed",
    });
  });

  it("has no asOf when the title carries no time", () => {
    expect(parseTitle("台股盤面摘要 2026-10-08（收盤後）")).toEqual({
      tradeDate: "2026-10-08",
      asOf: null,
      session: "closed",
    });
  });

  it("reads an intraday session", () => {
    expect(parseTitle("台股族群即時狀態 2026-10-08 10:05（盤中）").session).toBe("intraday");
  });

  it("marks the session unknown when the title does not say", () => {
    expect(parseTitle("族群「石英元件」成分股即時狀態 2026-10-08 13:34")).toEqual({
      tradeDate: "2026-10-08",
      asOf: "13:34",
      session: "unknown",
    });
  });

  it("throws when no ISO date is present", () => {
    expect(() => parseTitle("台股盤面摘要")).toThrow(DarkfanxingParseError);
  });
});
