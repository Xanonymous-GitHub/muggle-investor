import { describe, expect, it } from "vitest";
import { SAFE_CODE, safeCode } from "./safe-code";

describe("safeCode", () => {
  it("returns a well-formed string code", () => {
    expect(safeCode(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe("ECONNRESET");
    expect(safeCode({ code: "23505" })).toBe("23505");
  });

  it.each([
    ["free text", { code: "password is hunter2" }],
    ["too long", { code: "A".repeat(33) }],
    ["a number", { code: 42 }],
    ["no code", new Error("x")],
    ["null", null],
    ["a string", "ECONNRESET"],
  ])("returns undefined for %s", (_label, error) => {
    expect(safeCode(error)).toBeUndefined();
  });

  it("exports the pattern", () => {
    expect(SAFE_CODE.test("ABC_1.2-3")).toBe(true);
  });
});
