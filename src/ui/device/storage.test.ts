import { afterEach, describe, expect, it, vi } from "vitest";
import { keysWithPrefix, readItem, removeItem, writeItem } from "@/ui/device/storage";

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

  it("lists the keys under a prefix", () => {
    writeItem("p.a", "1");
    writeItem("p.b", "2");
    writeItem("q.c", "3");
    expect(keysWithPrefix("p.").sort()).toEqual(["p.a", "p.b"]);
  });

  it("swallows a throwing window.localStorage getter", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readItem("k")).toBeNull();
    expect(writeItem("k", "v")).toBe(false);
    expect(removeItem("k")).toBe(false);
    expect(keysWithPrefix("")).toEqual([]);
  });

  it("removeItem reports whether the key is gone, and is true for a missing key", () => {
    window.localStorage.setItem("k", "v");
    expect(removeItem("k")).toBe(true);
    expect(window.localStorage.getItem("k")).toBeNull();
    expect(removeItem("k")).toBe(true);
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(removeItem("k")).toBe(false);
  });

  it("swallows a quota error on write", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(writeItem("k", "v")).toBe(false);
  });
});
