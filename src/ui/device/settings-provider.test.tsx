import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { SettingsProvider, useSettings } from "@/ui/device/settings-provider";

function Probe({ log }: { log?: string[] }) {
  const { settings, ready, setLens, setTheme } = useSettings();
  log?.push(`${ready}:${settings.lens}`);
  return (
    <div>
      <span data-testid="state">{`${ready}|${settings.lens}|${settings.theme}`}</span>
      <button type="button" onClick={() => setLens("pro")}>
        pro
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        dark
      </button>
    </div>
  );
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("SettingsProvider", () => {
  it("renders defaults with ready=false first, then ready=true", () => {
    const log: string[] = [];
    render(
      <SettingsProvider>
        <Probe log={log} />
      </SettingsProvider>,
    );
    expect(log[0]).toBe("false:beginner");
    expect(screen.getByTestId("state").textContent).toBe("true|beginner|system");
  });

  it("loads stored settings after mount", () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"lens":"pro","theme":"light"}');
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("true|pro|light");
  });

  it("persists setLens and re-renders consumers", async () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    await userEvent.click(screen.getByText("pro"));
    expect(screen.getByTestId("state").textContent).toBe("true|pro|system");
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "")).toEqual({
      lens: "pro",
      theme: "system",
    });
  });

  it("setTheme persists and applies the theme", async () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    await userEvent.click(screen.getByText("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "").theme).toBe("dark");
  });

  it("falls back to defaults on stored garbage", () => {
    window.localStorage.setItem(SETTINGS_KEY, "{not json");
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("true|beginner|system");
  });

  it("follows a storage event for the settings key", () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: SETTINGS_KEY, newValue: '{"lens":"pro"}' }),
      );
    });
    expect(screen.getByTestId("state").textContent).toBe("true|pro|system");
  });

  it("ignores a storage event for another key", () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "other", newValue: '{"lens":"pro"}' }),
      );
    });
    expect(screen.getByTestId("state").textContent).toBe("true|beginner|system");
  });
});
