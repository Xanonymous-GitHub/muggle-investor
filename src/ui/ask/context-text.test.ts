import { describe, expect, it } from "vitest";
import { contextLine, contextParts } from "./context-text";

describe("contextParts and contextLine", () => {
  it("names only what the request carries, as counts", () => {
    expect(contextParts({ plan: true, holdings: 2, memory: 1 })).toEqual([
      "規劃答案",
      "2 檔持股",
      "1 則記住的事",
    ]);
    expect(contextLine({ plan: false, holdings: 3, memory: 0 })).toBe("3 檔持股");
    expect(contextLine({ plan: true, holdings: 0, memory: 2 })).toBe("規劃答案 · 2 則記住的事");
  });

  it("is null for a question that carries nothing personal", () => {
    expect(contextParts({ plan: false, holdings: 0, memory: 0 })).toEqual([]);
    expect(contextLine({ plan: false, holdings: 0, memory: 0 })).toBeNull();
  });
});
