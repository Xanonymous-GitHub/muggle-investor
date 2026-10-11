import { describe, expect, it } from "vitest";
import { cacheControlFor, errorJson, marketJson } from "./responses";

describe("market responses", () => {
  it("is uncacheable while data is moving and cacheable once settled", () => {
    expect(cacheControlFor("intraday")).toBe("no-store");
    expect(cacheControlFor("settling")).toBe("no-store");
    for (const phase of ["post-close", "pre-open", "closed-day"] as const) {
      expect(cacheControlFor(phase)).toBe("public, s-maxage=300, stale-while-revalidate=600");
    }
  });

  it("labels the data date in headers when known", async () => {
    const res = marketJson({ a: 1 }, "post-close", { tradeDate: "2026-10-08", asOf: "13:34" });
    expect(res.headers.get("x-data-trade-date")).toBe("2026-10-08");
    expect(res.headers.get("x-data-as-of")).toBe("13:34");
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("omits as-of when the report has none, and both headers without data", () => {
    const partial = marketJson({}, "intraday", { tradeDate: "2026-10-08", asOf: null });
    expect(partial.headers.get("x-data-as-of")).toBeNull();
    const none = marketJson({}, "intraday", null);
    expect(none.headers.get("x-data-trade-date")).toBeNull();
    expect(none.headers.get("cache-control")).toBe("no-store");
  });

  it("errors are never cached", async () => {
    const res = errorJson("not_found", 404);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
