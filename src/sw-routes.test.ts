import { describe, expect, it } from "vitest";
import {
  APP_SHELL_ROUTES,
  APP_SHELL_URL,
  isApiRequest,
  isNavigationFallbackCandidate,
  isStorablePage,
  OBSOLETE_CACHES,
  pageCacheKey,
  shouldKeepPageEntry,
} from "@/sw-routes";

const ORIGIN = "http://localhost:3000";
const navigate = { mode: "navigate", destination: "document" };

describe("isNavigationFallbackCandidate", () => {
  it("accepts a same-origin document navigation", () => {
    expect(isNavigationFallbackCandidate(navigate, new URL("/sectors", ORIGIN), ORIGIN)).toBe(true);
  });

  it("rejects a navigation under /api/", () => {
    expect(
      isNavigationFallbackCandidate(navigate, new URL("/api/market/today", ORIGIN), ORIGIN),
    ).toBe(false);
  });

  it("rejects a cross-origin navigation", () => {
    expect(
      isNavigationFallbackCandidate(navigate, new URL("https://example.com/sectors"), ORIGIN),
    ).toBe(false);
  });

  it("rejects a request that is not a navigation", () => {
    expect(
      isNavigationFallbackCandidate(
        { mode: "cors", destination: "" },
        new URL("/sectors", ORIGIN),
        ORIGIN,
      ),
    ).toBe(false);
  });
});

describe("isApiRequest", () => {
  it("matches same-origin /api/ paths only", () => {
    expect(isApiRequest(new URL("/api/market/today", ORIGIN), ORIGIN)).toBe(true);
    expect(isApiRequest(new URL("/api", ORIGIN), ORIGIN)).toBe(true);
    expect(isApiRequest(new URL("/apiary", ORIGIN), ORIGIN)).toBe(false);
    expect(isApiRequest(new URL("https://example.com/api/x"), ORIGIN)).toBe(false);
  });
});

describe("app shell", () => {
  it("falls back to / and warms every top-level page", () => {
    expect(APP_SHELL_URL).toBe("/");
    expect(APP_SHELL_ROUTES).toEqual(["/", "/sectors", "/glossary", "/settings"]);
  });
});

describe("pageCacheKey", () => {
  it("drops the query string, which only carries client state such as ?group=", () => {
    const url = new URL("/sectors?group=%E8%BB%B8%E6%89%BF", ORIGIN);
    expect(pageCacheKey(url)).toBe(`${ORIGIN}/sectors`);
  });

  it("drops the hash and keeps the path", () => {
    expect(pageCacheKey(new URL("/glossary#pe", ORIGIN))).toBe(`${ORIGIN}/glossary`);
  });
});

describe("shouldKeepPageEntry", () => {
  it("keeps the shell routes without a query", () => {
    for (const route of APP_SHELL_ROUTES) {
      expect(shouldKeepPageEntry(new URL(route, ORIGIN))).toBe(true);
    }
  });

  it("drops other paths and query variants left by earlier workers", () => {
    expect(shouldKeepPageEntry(new URL("/sectors?group=x", ORIGIN))).toBe(false);
    expect(shouldKeepPageEntry(new URL("/old-page", ORIGIN))).toBe(false);
  });
});

describe("isStorablePage", () => {
  it("stores a plain 200", () => {
    expect(isStorablePage({ status: 200, redirected: false })).toBe(true);
  });

  it("refuses redirected responses and errors", () => {
    expect(isStorablePage({ status: 200, redirected: true })).toBe(false);
    expect(isStorablePage({ status: 500, redirected: false })).toBe(false);
    expect(isStorablePage({ status: 404, redirected: false })).toBe(false);
  });
});

describe("OBSOLETE_CACHES", () => {
  it("lists the API cache earlier workers filled through defaultCache", () => {
    expect(OBSOLETE_CACHES).toEqual(["apis"]);
  });
});
