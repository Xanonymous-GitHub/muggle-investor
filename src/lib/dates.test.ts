import { describe, expect, it } from "vitest";
import { isCalendarDate } from "./dates";

describe("isCalendarDate", () => {
  it.each(["2026-10-08", "2024-02-29", "2026-12-31", "2026-01-01"])("accepts %s", (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each([
    ["2026-13-45", "impossible month"],
    ["2026-02-30", "impossible day"],
    ["2026-02-29", "not a leap year"],
    ["2026-00-10", "month zero"],
    ["2026-1-5", "unpadded"],
    ["20261008", "no separators"],
    ["2026-10-08T00:00:00Z", "has a time"],
    ["", "empty"],
    ["abc", "not a date"],
  ])("rejects %s (%s)", (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});
