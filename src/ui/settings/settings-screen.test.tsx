import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { SettingsScreen } from "@/ui/settings/settings-screen";

function renderScreen() {
  return render(
    <SettingsProvider>
      <SettingsScreen />
    </SettingsProvider>,
  );
}

function stored(): unknown {
  return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null");
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("SettingsScreen", () => {
  it("offers every option as a named radio and states where settings live", () => {
    renderScreen();
    for (const name of ["入門", "專業", "跟隨系統", "淺色", "深色"]) {
      expect(screen.getByRole("radio", { name })).toBeTruthy();
    }
    expect(screen.getByText("設定只存在這個裝置上。")).toBeTruthy();
  });

  it("defaults to 入門 and 跟隨系統", () => {
    renderScreen();
    expect(screen.getByRole("radio", { name: "入門" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "跟隨系統" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("stores lens pro when 專業 is chosen", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("radio", { name: "專業" }));
    expect(stored()).toEqual({ lens: "pro", theme: "system" });
    expect(screen.getByRole("radio", { name: "專業" }).getAttribute("aria-checked")).toBe("true");
  });

  it("stores theme dark and adds the dark class when 深色 is chosen", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("radio", { name: "深色" }));
    expect(stored()).toEqual({ lens: "beginner", theme: "dark" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("checks the radios that match stored settings after mount", () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"lens":"pro","theme":"light"}');
    renderScreen();
    expect(screen.getByRole("radio", { name: "專業" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "淺色" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "入門" }).getAttribute("aria-checked")).toBe("false");
  });
});
