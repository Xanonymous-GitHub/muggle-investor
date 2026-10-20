import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissInstall,
  INSTALL_DISMISS_MS,
  INSTALL_DISMISSED_KEY,
  isInstallDismissed,
} from "@/ui/pwa/install";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

describe("install dismissal", () => {
  it("uses the namespaced key and a 30 day window", () => {
    expect(INSTALL_DISMISSED_KEY).toBe("muggle.pwa.install-dismissed.v1");
    expect(INSTALL_DISMISS_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("is not dismissed when nothing is stored", () => {
    expect(isInstallDismissed(NOW)).toBe(false);
  });

  it("stores the timestamp and is dismissed right after", () => {
    dismissInstall(NOW);
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe(String(NOW));
    expect(isInstallDismissed(NOW)).toBe(true);
  });

  it("defaults to the current time", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    dismissInstall();
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe(String(NOW));
    expect(isInstallDismissed()).toBe(true);
  });

  it("stays hidden for 30 days minus one second, and shows again after 30 days", () => {
    dismissInstall(NOW);
    expect(isInstallDismissed(NOW + INSTALL_DISMISS_MS - 1000)).toBe(true);
    expect(isInstallDismissed(NOW + INSTALL_DISMISS_MS)).toBe(false);
    expect(isInstallDismissed(NOW + INSTALL_DISMISS_MS + 1000)).toBe(false);
  });

  it.each(["", "abc", "NaN", "-5", "1e999", '{"at":1}', "12.5x"])(
    "treats the corrupt value %j as not dismissed",
    (raw) => {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, raw);
      expect(isInstallDismissed(NOW)).toBe(false);
    },
  );

  it("treats a timestamp from the future as corrupt", () => {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(NOW + 60_000));
    expect(isInstallDismissed(NOW)).toBe(false);
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => dismissInstall(NOW)).not.toThrow();
    expect(isInstallDismissed(NOW)).toBe(false);
  });
});
