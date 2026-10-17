import { describe, expect, it } from "vitest";
import { SAFE_CODE, safeCauseCode, safeCode } from "./safe-code";

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

describe("safeCauseCode", () => {
  const chain = (depth: number, code: string) => {
    let error: unknown = { code };
    for (let i = 0; i < depth; i++) error = new Error(`level ${i}`, { cause: error });
    return error;
  };

  it("finds a code on the error or up to three causes down", () => {
    expect(safeCauseCode(chain(0, "E0"))).toBe("E0");
    expect(safeCauseCode(chain(3, "ECONNREFUSED"))).toBe("ECONNREFUSED");
  });

  it("stops after three causes", () => {
    expect(safeCauseCode(chain(4, "EDEEP"))).toBeUndefined();
  });

  it("skips malformed codes and keeps looking", () => {
    const error = Object.assign(new Error("x", { cause: { code: "E_OK" } }), {
      code: "free text here",
    });
    expect(safeCauseCode(error)).toBe("E_OK");
    expect(safeCauseCode(chain(2, "not a code!"))).toBeUndefined();
  });

  it("survives a cause cycle", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(safeCauseCode(a)).toBeUndefined();
  });
});
