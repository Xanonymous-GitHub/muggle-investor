import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAskSession } from "@/ui/data/ask-auth";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { SettingsScreen } from "@/ui/settings/settings-screen";
import { renderFirstFrame } from "@/ui/test/first-frame";

vi.mock("@/ui/data/ask-auth", () => ({ deleteAskSession: vi.fn() }));
const signOut = vi.mocked(deleteAskSession);

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
  signOut.mockReset();
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

  it("shows the stored lens and theme in the first frame, before paint", () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"lens":"pro","theme":"dark"}');
    const frame = renderFirstFrame(
      <SettingsProvider>
        <SettingsScreen />
      </SettingsProvider>,
    );
    const checkedNames = [
      ...frame.container.querySelectorAll('[role="radio"][aria-checked="true"]'),
    ].map((radio) => frame.container.querySelector(`label[for="${radio.id}"]`)?.textContent);
    frame.unmount();
    expect(checkedNames).toEqual(["專業", "深色"]);
  });

  it("signs out of 問問看 and confirms with 已登出", async () => {
    signOut.mockResolvedValue(true);
    renderScreen();
    expect(screen.queryByText("已登出")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "登出問問看" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toBe("已登出");
  });

  it("says so when the sign-out failed", async () => {
    signOut.mockResolvedValue(false);
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "登出問問看" }));
    expect((await screen.findByRole("alert")).textContent).toContain("登出失敗");
    expect(screen.queryByText("已登出")).toBeNull();
  });
});
