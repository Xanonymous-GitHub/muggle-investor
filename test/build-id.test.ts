import { describe, expect, it } from "vitest";
import { buildId } from "../vite.config";

describe("buildId", () => {
  it("is unique per build and 'dev' for the dev server", () => {
    expect(buildId("serve")).toBe("dev");
    const a = buildId("build", new Date(Date.UTC(2026, 9, 14, 0, 0)));
    const b = buildId("build", new Date(Date.UTC(2026, 9, 14, 0, 1)));
    expect(a).not.toBe("dev");
    expect(a).not.toBe(b);
  });
});
