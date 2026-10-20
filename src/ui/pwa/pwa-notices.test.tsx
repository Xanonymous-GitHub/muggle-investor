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

const update = vi.hoisted(() => ({ ready: false, reload: vi.fn() }));
vi.mock("@/ui/pwa/use-update-available", () => ({
  useUpdateAvailable: () => ({ ready: update.ready, reload: update.reload }),
}));

/** The live regions stay mounted when nothing is shown, so "nothing" means empty, not absent. */
function expectNothingShown(container: HTMLElement) {
  expect(screen.getAllByRole("status")).toHaveLength(2);
  expect(container.textContent).toBe("");
  expect(container.querySelector("button")).toBeNull();
}

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  hook.mode = "none";
  hook.install.mockReset();
  update.ready = false;
  update.reload.mockReset();
  window.localStorage.clear();
});

describe("PwaNotices install notice", () => {
  it("offers 安裝 in prompt mode as a status line with 44px buttons", () => {
    hook.mode = "prompt";
    render(<PwaNotices />);
    const status = screen.getAllByRole("status")[1] as HTMLElement;
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
    expectNothingShown(container);
  });

  it("hides on 先不要 and stores the timestamp", async () => {
    hook.mode = "prompt";
    const { container } = render(<PwaNotices />);
    await userEvent.click(screen.getByRole("button", { name: "先不要" }));
    expectNothingShown(container);
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe(String(NOW));
  });

  it("stays hidden for 30 days minus one second", () => {
    hook.mode = "prompt";
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(NOW - INSTALL_DISMISS_MS + 1000));
    const { container } = render(<PwaNotices />);
    expectNothingShown(container);
  });

  it("shows again after 30 days", () => {
    hook.mode = "ios";
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(NOW - INSTALL_DISMISS_MS));
    render(<PwaNotices />);
    expect(screen.getAllByRole("status")[1]?.textContent).toContain("加到主畫面");
  });

  it("shows when the stored value is corrupt", () => {
    hook.mode = "prompt";
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, "not a number");
    render(<PwaNotices />);
    expect(screen.getByRole("button", { name: "安裝" })).toBeTruthy();
  });
});

describe("PwaNotices update notice", () => {
  it("renders nothing when no update is ready", () => {
    const { container } = render(<PwaNotices />);
    expectNothingShown(container);
  });

  it("shows 有新版本可以使用 as a status line with a 44px 重新載入 button", () => {
    update.ready = true;
    render(<PwaNotices />);
    expect(screen.getAllByRole("status")[0]?.textContent).toContain("有新版本可以使用");
    expect(screen.getByRole("button", { name: "重新載入" }).className).toContain("min-h-11");
  });

  it("is not dismissible and does not reload by itself", () => {
    update.ready = true;
    render(<PwaNotices />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "先不要" })).toBeNull();
    expect(update.reload).not.toHaveBeenCalled();
  });

  it("calls reload() once when 重新載入 is pressed", async () => {
    update.ready = true;
    render(<PwaNotices />);
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));
    expect(update.reload).toHaveBeenCalledTimes(1);
  });

  it("is not hidden by an install dismissal", () => {
    update.ready = true;
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(NOW));
    render(<PwaNotices />);
    expect(screen.getByRole("button", { name: "重新載入" })).toBeTruthy();
  });

  it("renders both with the update notice first", () => {
    update.ready = true;
    hook.mode = "prompt";
    render(<PwaNotices />);
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]?.textContent).toContain("有新版本可以使用");
    expect(statuses[1]?.textContent).toContain("把 Muggle Investor 加到主畫面");
  });
});

describe("PwaNotices live regions", () => {
  it("has an empty live region for each notice before any content appears", () => {
    const { container } = render(<PwaNotices />);
    expectNothingShown(container);
    for (const status of screen.getAllByRole("status")) expect(status.childElementCount).toBe(0);
  });

  it("fills the region that was already there when the update arrives", () => {
    const { rerender } = render(<PwaNotices />);
    const before = screen.getAllByRole("status")[0];
    update.ready = true;
    rerender(<PwaNotices />);
    const after = screen.getAllByRole("status")[0];
    expect(after).toBe(before);
    expect(after?.textContent).toContain("有新版本可以使用");
  });

  it("fills the region that was already there when the install offer arrives", () => {
    const { rerender } = render(<PwaNotices />);
    const before = screen.getAllByRole("status")[1];
    hook.mode = "prompt";
    rerender(<PwaNotices />);
    const after = screen.getAllByRole("status")[1];
    expect(after).toBe(before);
    expect(after?.textContent).toContain("加到主畫面");
  });

  it("keeps the styling off the region so an empty one takes no space", () => {
    update.ready = true;
    hook.mode = "prompt";
    render(<PwaNotices />);
    for (const status of screen.getAllByRole("status")) {
      expect(status.className).toBe("");
      const band = status.firstElementChild as HTMLElement;
      expect(band.className).toContain("mb-3");
      expect(band.className).toContain("md:mb-0");
      expect(band.className).toContain("border-b");
      // The content box lines up with <main>.
      const box = band.firstElementChild as HTMLElement;
      expect(box.className).toContain("mx-auto");
      expect(box.className).toContain("max-w-6xl");
      expect(box.className).toContain("md:px-8");
    }
  });

  it("leaves out the install notice when showInstall is false, but not the update notice", () => {
    update.ready = true;
    hook.mode = "prompt";
    render(<PwaNotices showInstall={false} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "重新載入" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "安裝" })).toBeNull();
  });
});
