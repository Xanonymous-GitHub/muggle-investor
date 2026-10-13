import { afterEach, describe, expect, it } from "vitest";
import { LAST_SEEN_KEY, readLastSeen, writeLastSeen } from "@/ui/device/last-seen";

afterEach(() => {
  window.localStorage.clear();
});

describe("last seen", () => {
  it("is null when nothing is stored", () => {
    expect(readLastSeen()).toBeNull();
  });

  it("rejects a stored value that is not a calendar date", () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "2026-13-45");
    expect(readLastSeen()).toBeNull();
  });

  it("stores a date and never moves backwards", () => {
    writeLastSeen("2026-10-08");
    writeLastSeen("2026-10-05");
    expect(readLastSeen()).toBe("2026-10-08");
    writeLastSeen("2026-10-09");
    expect(readLastSeen()).toBe("2026-10-09");
  });

  it("ignores an invalid date", () => {
    writeLastSeen("2026-02-30");
    expect(readLastSeen()).toBeNull();
  });

  it("overwrites a corrupt stored value", () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "garbage");
    writeLastSeen("2026-10-08");
    expect(readLastSeen()).toBe("2026-10-08");
  });
});
