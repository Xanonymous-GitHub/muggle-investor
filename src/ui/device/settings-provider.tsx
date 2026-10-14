"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Lens } from "@/insight/lens";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  SETTINGS_KEY,
  type Settings,
  serializeSettings,
} from "@/ui/device/settings";
import { readItem, writeItem } from "@/ui/device/storage";
import { applyTheme, type ThemePref } from "@/ui/theme/theme";

type SettingsContextValue = {
  settings: Settings;
  /**
   * False until the device's stored settings have been read; the first render shows defaults,
   * replaced before the first paint.
   */
  ready: boolean;
  setLens(lens: Lens): void;
  setTheme(theme: ThemePref): void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const latest = useRef(settings);

  // Storage is read in an effect, never during render, so server and client markup match. A
  // layout effect, so the stored lens and theme replace the defaults before the first paint.
  useLayoutEffect(() => {
    const stored = parseSettings(readItem(SETTINGS_KEY));
    latest.current = stored;
    setSettings(stored);
    setReady(true);

    // Another tab changed (or cleared) the settings.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SETTINGS_KEY) return;
      const next = parseSettings(event.newValue);
      latest.current = next;
      setSettings(next);
      applyTheme(next.theme);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // While following the system, track its light/dark switches.
  const { theme } = settings;
  useEffect(() => {
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const commit = useCallback((next: Settings) => {
    latest.current = next;
    setSettings(next);
    writeItem(SETTINGS_KEY, serializeSettings(next));
  }, []);

  const setLens = useCallback((lens: Lens) => commit({ ...latest.current, lens }), [commit]);

  const setTheme = useCallback(
    (nextTheme: ThemePref) => {
      commit({ ...latest.current, theme: nextTheme });
      applyTheme(nextTheme);
    },
    [commit],
  );

  const value = useMemo(
    () => ({ settings, ready, setLens, setTheme }),
    [settings, ready, setLens, setTheme],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (value === null) throw new Error("useSettings must be used inside <SettingsProvider>");
  return value;
}
