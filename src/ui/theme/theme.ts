import { SETTINGS_KEY } from "@/ui/device/settings";

export type ThemePref = "system" | "light" | "dark";

export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

export function applyTheme(pref: ThemePref): void {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(pref, systemDark);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

// Runs inline in <head> before first paint, so it cannot import anything: it must stay a
// self-contained IIFE and mirror resolveTheme/applyTheme. The storage key is interpolated
// from settings.ts (which only type-imports this file, so there is no runtime cycle); the
// `theme` field it reads is the one settings.ts owns. Any failure (blocked storage, bad
// JSON) falls back to following the system.
export const THEME_INIT_SCRIPT = `(function () {
  try {
    var pref = "system";
    try {
      var raw = localStorage.getItem(${JSON.stringify(SETTINGS_KEY)});
      var theme = raw ? JSON.parse(raw).theme : undefined;
      if (theme === "light" || theme === "dark") pref = theme;
    } catch (e) {}
    var dark = pref === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : pref === "dark";
    var root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {}
})();`;
