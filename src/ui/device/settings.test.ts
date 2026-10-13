import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  SETTINGS_KEY,
  serializeSettings,
} from "@/ui/device/settings";
import { THEME_INIT_SCRIPT } from "@/ui/theme/theme";

describe("parseSettings", () => {
  it("returns the defaults for null and for broken JSON", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps a valid field and defaults the missing one", () => {
    expect(parseSettings('{"lens":"pro"}')).toEqual({ lens: "pro", theme: "system" });
  });

  it("falls back per field", () => {
    expect(parseSettings('{"lens":"pro","theme":"x"}')).toEqual({ lens: "pro", theme: "system" });
    expect(parseSettings('{"lens":"x","theme":"dark"}')).toEqual({
      lens: "beginner",
      theme: "dark",
    });
  });

  it("round-trips through serializeSettings", () => {
    const s = { lens: "pro", theme: "dark" } as const;
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });
});

describe("settings key", () => {
  it("is the key the no-flash theme script reads", () => {
    expect(THEME_INIT_SCRIPT).toContain(SETTINGS_KEY);
  });
});
