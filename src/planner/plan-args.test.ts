import { describe, expect, it } from "vitest";
import { parsePlanArgs } from "./plan-args";
import { scoreProfile } from "./rules/questionnaire";

const FULL = [
  "--level",
  "3",
  "--lump",
  "600000",
  "--monthly",
  "15000",
  "--expenses",
  "30000",
  "--reserve",
  "90000",
  "--income",
  "stable",
];

describe("parsePlanArgs", () => {
  it("builds a plan request whose answers score back to the requested level", () => {
    const parsed = parsePlanArgs(FULL);
    if (!parsed.ok || parsed.value.mode !== "plan") throw new Error("expected a plan");
    const { request, level } = parsed.value;
    expect(level).toBe(3);
    expect(request).toMatchObject({
      lump: 600_000,
      monthly: 15_000,
      monthlyExpenses: 30_000,
      existingReserve: 90_000,
    });
    expect(request.answers.income).toBe("income-stable");
    expect(scoreProfile(request.answers).level).toBe(3);
  });

  it.each([1, 2, 3, 4, 5])("reaches level %i with a stable income", (level) => {
    const argv = FULL.map((arg, i) => (FULL[i - 1] === "--level" ? String(level) : arg));
    const parsed = parsePlanArgs(argv);
    if (!parsed.ok || parsed.value.mode !== "plan") throw new Error("expected a plan");
    expect(scoreProfile(parsed.value.request.answers).level).toBe(level);
  });

  it("recognises --discover alone", () => {
    expect(parsePlanArgs(["--discover"])).toEqual({ ok: true, value: { mode: "discover" } });
  });

  it("rejects a missing value, a non-numeric value and an unknown flag in one line", () => {
    const without = (flag: string) =>
      FULL.filter((_, i) => FULL[i] !== flag && FULL[i - 1] !== flag);
    for (const argv of [
      without("--lump"),
      FULL.map((arg) => (arg === "600000" ? "abc" : arg)),
      FULL.map((arg) => (arg === "600000" ? "-5" : arg)),
      FULL.map((arg) => (arg === "600000" ? "1.5" : arg)),
      FULL.map((arg) => (arg === "stable" ? "rich" : arg)),
      FULL.map((arg) => (arg === "3" ? "6" : arg)),
      [...FULL, "--bogus", "1"],
      FULL.slice(0, -1),
    ]) {
      const parsed = parsePlanArgs(argv);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).not.toMatch(/\n/);
    }
  });

  it("rejects a level the income cannot reach", () => {
    const argv = FULL.map((arg) => (arg === "stable" ? "unstable" : arg)).map((arg, i) =>
      FULL[i - 1] === "--level" ? "5" : arg,
    );
    const parsed = parsePlanArgs(argv);
    expect(parsed).toEqual({ ok: false, message: expect.stringContaining("level 5") });
  });

  it("rejects a request with nothing to invest", () => {
    const argv = FULL.map((arg) => (arg === "600000" || arg === "15000" ? "0" : arg));
    expect(parsePlanArgs(argv).ok).toBe(false);
  });
});
