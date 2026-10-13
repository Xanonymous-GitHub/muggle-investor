import { z } from "zod";
import { LENSES, type Lens } from "@/insight/lens";
import type { ThemePref } from "@/ui/theme/theme";

export type Settings = { lens: Lens; theme: ThemePref };

export const DEFAULT_SETTINGS: Settings = { lens: "beginner", theme: "system" };

// Also read by THEME_INIT_SCRIPT, which builds itself from this constant.
export const SETTINGS_KEY = "muggle.settings.v1";

// `.catch` falls back per field, so one bad value never discards the other.
const settingsSchema = z.object({
  lens: z.enum(LENSES).catch(DEFAULT_SETTINGS.lens),
  theme: z.enum(["system", "light", "dark"]).catch(DEFAULT_SETTINGS.theme),
});

export function parseSettings(raw: string | null): Settings {
  if (raw === null) return DEFAULT_SETTINGS;
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function serializeSettings(s: Settings): string {
  return JSON.stringify({ lens: s.lens, theme: s.theme });
}
