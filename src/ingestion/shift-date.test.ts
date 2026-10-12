import { describe, expect, it } from "vitest";
import { daysBetween, shiftDate } from "./shift-date";

describe("daysBetween", () => {
  it("counts calendar days from the first date to the second", () => {
    expect(daysBetween("2026-10-05", "2026-10-08")).toBe(3);
    expect(daysBetween("2026-10-08", "2026-10-08")).toBe(0);
  });

  it("is negative when the second date is earlier", () => {
    expect(daysBetween("2026-10-08", "2026-10-05")).toBe(-3);
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(daysBetween("2026-09-28", "2026-10-03")).toBe(5);
    expect(daysBetween("2025-12-30", "2026-01-02")).toBe(3);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("inverts shiftDate", () => {
    expect(daysBetween("2026-10-08", shiftDate("2026-10-08", -120))).toBe(-120);
  });
});
