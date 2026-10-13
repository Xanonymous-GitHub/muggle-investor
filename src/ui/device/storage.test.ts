import { afterEach, describe, expect, it, vi } from "vitest";
import { readItem, removeItem, writeItem } from "@/ui/device/storage";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("storage", () => {
  it("round-trips a value and removes it", () => {
    expect(writeItem("k", "v")).toBe(true);
    expect(readItem("k")).toBe("v");
    removeItem("k");
    expect(readItem("k")).toBeNull();
  });

  it("returns null for a missing key", () => {
    expect(readItem("missing")).toBeNull();
  });

  it("swallows a throwing window.localStorage getter", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readItem("k")).toBeNull();
    expect(writeItem("k", "v")).toBe(false);
    expect(() => removeItem("k")).not.toThrow();
  });

  it("swallows a quota error on write", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(writeItem("k", "v")).toBe(false);
  });
});
