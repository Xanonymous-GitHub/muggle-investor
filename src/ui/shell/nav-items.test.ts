import { describe, expect, it } from "vitest";
import { isActive } from "@/ui/shell/nav-items";

describe("isActive", () => {
  it("matches the root exactly", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/glossary", "/")).toBe(false);
  });

  it("matches other items on a segment boundary", () => {
    expect(isActive("/sectors", "/sectors")).toBe(true);
    expect(isActive("/sectors/x", "/sectors")).toBe(true);
    expect(isActive("/sectorsX", "/sectors")).toBe(false);
  });
});
