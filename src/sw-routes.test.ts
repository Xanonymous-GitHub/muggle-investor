import { describe, expect, it } from "vitest";
import {
  APP_SHELL_ROUTES,
  APP_SHELL_URL,
  isApiRequest,
  isNavigationFallbackCandidate,
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
