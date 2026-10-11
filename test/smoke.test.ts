import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/lib/version";

describe("smoke", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolves the @/ alias", () => {
    expect(APP_NAME).toBe("Muggle Investor");
  });
});
