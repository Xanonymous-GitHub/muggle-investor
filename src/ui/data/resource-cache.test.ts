import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_VERSION,
  type CacheEntry,
  cacheVersionFor,
  clearCache,
  MAX_CACHE_ENTRIES,
  readCache,
  writeCache,
} from "@/ui/data/resource-cache";

const entry = <T>(body: T, savedAt: string, dataDate: string | null = null): CacheEntry<T> => ({
  v: CACHE_VERSION,
  savedAt,
  dataDate,
  body,
});

/** An ISO timestamp `i` minutes after a fixed base, so entries sort in write order. */
const minute = (i: number): string => new Date(Date.UTC(2026, 9, 13, 0, i)).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("resource cache", () => {
  it("round-trips an entry under the muggle.cache. prefix", () => {
    const e = entry({ a: 1 }, minute(0), "2026-10-08");
    writeCache("/api/x", e);
    expect(readCache("/api/x")).toEqual(e);
    expect(window.localStorage.getItem("muggle.cache./api/x")).not.toBeNull();
  });

  it("returns null for a missing url", () => {
    expect(readCache("/api/none")).toBeNull();
  });

  it("returns null for an entry of another version", () => {
    window.localStorage.setItem(
      "muggle.cache./api/x",
      JSON.stringify({ v: CACHE_VERSION + 1, savedAt: minute(0), dataDate: null, body: 1 }),
    );
    expect(readCache("/api/x")).toBeNull();
  });

  it("scopes the version to the build, so a new deploy never reads the last one's bodies", () => {
    expect(cacheVersionFor("build-a")).not.toBe(cacheVersionFor("build-b"));
    // Tests and the dev server have no build id.
    expect(CACHE_VERSION).toBe(cacheVersionFor("dev"));
    window.localStorage.setItem(
      "muggle.cache./api/x",
      JSON.stringify({
        v: cacheVersionFor("older-build"),
        savedAt: minute(0),
        dataDate: null,
        body: 1,
      }),
    );
    expect(readCache("/api/x")).toBeNull();
  });

  it("clearCache removes every cached response and nothing else", () => {
    window.localStorage.setItem("muggle.settings.v1", "{}");
    writeCache("/api/a", entry(1, minute(0)));
    writeCache("/api/b", entry(2, minute(1)));
    clearCache();
    expect(readCache("/api/a")).toBeNull();
    expect(readCache("/api/b")).toBeNull();
    expect(window.localStorage.getItem("muggle.settings.v1")).toBe("{}");
  });

  it("returns null for corrupt JSON and for a malformed entry", () => {
    window.localStorage.setItem("muggle.cache./api/x", "{not json");
    expect(readCache("/api/x")).toBeNull();
    window.localStorage.setItem("muggle.cache./api/y", JSON.stringify({ v: CACHE_VERSION }));
    expect(readCache("/api/y")).toBeNull();
  });

  it("evicts the oldest entry on the 31st write", () => {
    expect(MAX_CACHE_ENTRIES).toBe(30);
    for (let i = 0; i < 31; i++) writeCache(`/api/n${i}`, entry(i, minute(i)), new Date(minute(i)));
    expect(readCache("/api/n0")).toBeNull();
    for (let i = 1; i < 31; i++) expect(readCache(`/api/n${i}`)?.body).toBe(i);
  });

  it("evicts by savedAt, not by write order", () => {
    for (let i = 0; i < 30; i++) writeCache(`/api/n${i}`, entry(i, minute(i + 1)));
    writeCache("/api/n7", entry(7, minute(100)));
    writeCache("/api/new", entry("new", minute(101)));
    expect(readCache("/api/n0")).toBeNull();
    expect(readCache("/api/n7")?.body).toBe(7);
    expect(readCache("/api/new")?.body).toBe("new");
  });

  it("rewriting a url does not evict anything", () => {
    for (let i = 0; i < 30; i++) writeCache(`/api/n${i}`, entry(i, minute(i)));
    writeCache("/api/n5", entry("again", minute(50)));
    for (let i = 0; i < 30; i++) expect(readCache(`/api/n${i}`)).not.toBeNull();
  });

  it("leaves other localStorage keys alone", () => {
    window.localStorage.setItem("muggle.settings.v1", "{}");
    for (let i = 0; i < 31; i++) writeCache(`/api/n${i}`, entry(i, minute(i)));
    expect(window.localStorage.getItem("muggle.settings.v1")).toBe("{}");
  });

  it("does not store a body over 1 MB serialized", () => {
    writeCache("/api/big", entry("x".repeat(1_000_001), minute(0)));
    expect(readCache("/api/big")).toBeNull();
  });

  it("is silent when storage throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => writeCache("/api/x", entry(1, minute(0)))).not.toThrow();
    expect(readCache("/api/x")).toBeNull();
  });

  it("is silent on a quota error", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeCache("/api/x", entry(1, minute(0)))).not.toThrow();
    expect(readCache("/api/x")).toBeNull();
  });
});
