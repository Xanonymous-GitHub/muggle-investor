import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INSTALL_DISMISS_MS, INSTALL_DISMISSED_KEY } from "@/ui/pwa/install";
import { PwaNotices } from "@/ui/pwa/pwa-notices";
import type { InstallMode } from "@/ui/pwa/use-install-prompt";

const hook = vi.hoisted(() => ({
  mode: "none" as InstallMode,
  install: vi.fn(),
}));
vi.mock("@/ui/pwa/use-install-prompt", () => ({
  useInstallPrompt: () => ({ mode: hook.mode, install: hook.install }),
}));

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  hook.mode = "none";
  hook.install.mockReset();
  window.localStorage.clear();
});

describe("PwaNotices install notice", () => {
  it("offers 安裝 in prompt mode as a status line with 44px buttons", () => {
    hook.mode = "prompt";
    render(<PwaNotices />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("把 Muggle Investor 加到主畫面，開啟更快、像一般 App。");
    const install = screen.getByRole("button", { name: "安裝" });
    const later = screen.getByRole("button", { name: "先不要" });
    for (const button of [install, later]) expect(button.className).toContain("min-h-11");
  });

  it("calls install() when 安裝 is pressed", async () => {
    hook.mode = "prompt";
    hook.install.mockResolvedValue("accepted");
    render(<PwaNotices />);
    await userEvent.click(screen.getByRole("button", { name: "安裝" }));
    expect(hook.install).toHaveBeenCalledTimes(1);
  });

  it("shows the share how-to, and no 安裝 button, in ios mode", () => {
    hook.mode = "ios";
    render(<PwaNotices />);
    expect(screen.getByText("點分享按鈕，再選『加入主畫面』")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "安裝" })).toBeNull();
    expect(screen.getByRole("button", { name: "先不要" })).toBeTruthy();
  });

  it.each(["installed", "none"] as const)("renders nothing in %s mode", (mode) => {
    hook.mode = mode;
    const { container } = render(<PwaNotices />);
    expect(container.innerHTML).toBe("");
  });

  it("hides on 先不要 and stores the timestamp", async () => {
    hook.mode = "prompt";
    render(<PwaNotices />);
    await userEvent.click(screen.getByRole("button", { name: "先不要" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe(String(NOW));
  });

  it("stays hidden for 30 days minus one second", () => {
    hook.mode = "prompt";
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(NOW - INSTALL_DISMISS_MS + 1000));
    const { container } = render(<PwaNotices />);
    expect(container.innerHTML).toBe("");
  });

  it("shows again after 30 days", () => {
    hook.mode = "ios";
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(NOW - INSTALL_DISMISS_MS));
    render(<PwaNotices />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("shows when the stored value is corrupt", () => {
    hook.mode = "prompt";
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, "not a number");
    render(<PwaNotices />);
    expect(screen.getByRole("button", { name: "安裝" })).toBeTruthy();
  });
});
