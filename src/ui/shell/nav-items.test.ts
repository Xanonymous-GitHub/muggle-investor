import { describe, expect, it } from "vitest";
import { isActive, NAV_ITEMS } from "@/ui/shell/nav-items";

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

describe("NAV_ITEMS", () => {
  it("lists 問問看 fourth, between 規劃 and 名詞", () => {
    expect(NAV_ITEMS.map((item) => [item.href, item.label])).toEqual([
      ["/", "今日"],
      ["/sectors", "族群"],
      ["/plan", "規劃"],
      ["/ask", "問問看"],
      ["/glossary", "名詞"],
    ]);
  });

  it("keeps 問問看 active on its sub-paths", () => {
    expect(isActive("/ask", "/ask")).toBe(true);
    expect(isActive("/ask/x", "/ask")).toBe(true);
    expect(isActive("/asking", "/ask")).toBe(false);
  });

  it("keeps 規劃 active on its sub-paths", () => {
    expect(isActive("/plan/x", "/plan")).toBe(true);
    expect(isActive("/planet", "/plan")).toBe(false);
  });
});
