import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstallMode } from "@/ui/pwa/use-install-prompt";
import { AppShell } from "@/ui/shell/app-shell";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

const install = vi.hoisted(() => ({ mode: "none" as InstallMode }));
vi.mock("@/ui/pwa/use-install-prompt", () => ({
  useInstallPrompt: () => ({ mode: install.mode, install: vi.fn() }),
}));

const OFFLINE_TEXT = "目前離線，顯示的是上次載入的資料。";
const OFFLINE_ASK_TEXT = "目前離線。問問看需要連線才能提問，你可以先看之前的對話。";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

afterEach(() => {
  install.mode = "none";
  window.localStorage.clear();
  pathname.value = "/";
  setOnline(true);
});

describe("AppShell", () => {
  it("renders the five labels and a settings link in both nav variants", () => {
    render(<AppShell>content</AppShell>);
    const bottom = screen.getByRole("navigation", { name: "主要導覽" });
    const side = screen.getByRole("navigation", { name: "側邊導覽" });
    for (const nav of [bottom, side]) {
      for (const label of ["今日", "族群", "規劃", "問問看", "名詞"]) {
        expect(within(nav).getByRole("link", { name: label })).toBeTruthy();
      }
    }
    expect(within(side).getByRole("link", { name: "設定" }).getAttribute("href")).toBe("/settings");
    // The phone header carries the gear as well.
    const gears = screen.getAllByRole("link", { name: "設定" });
    expect(gears).toHaveLength(2);
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("marks only the active item with aria-current=page", () => {
    pathname.value = "/sectors/semis";
    render(<AppShell>x</AppShell>);
    const bottom = screen.getByRole("navigation", { name: "主要導覽" });
    expect(within(bottom).getByRole("link", { name: "族群" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(bottom).getByRole("link", { name: "今日" }).getAttribute("aria-current")).toBe(
      null,
    );
    expect(within(bottom).getByRole("link", { name: "名詞" }).getAttribute("aria-current")).toBe(
      null,
    );
  });

  it("renders five bottom-bar links and marks 規劃 current on /plan", () => {
    pathname.value = "/plan";
    render(<AppShell>x</AppShell>);
    const bottom = screen.getByRole("navigation", { name: "主要導覽" });
    expect(within(bottom).getAllByRole("link")).toHaveLength(5);
    expect(bottom.className).toContain("grid-cols-5");
    const plan = within(bottom).getByRole("link", { name: "規劃" });
    expect(plan.getAttribute("href")).toBe("/plan");
    expect(plan.getAttribute("aria-current")).toBe("page");
    expect(within(bottom).getByRole("link", { name: "今日" }).getAttribute("aria-current")).toBe(
      null,
    );
  });

  it("marks 問問看 current on /ask", () => {
    pathname.value = "/ask";
    render(<AppShell>x</AppShell>);
    const bottom = screen.getByRole("navigation", { name: "主要導覽" });
    const ask = within(bottom).getByRole("link", { name: "問問看" });
    expect(ask.getAttribute("href")).toBe("/ask");
    expect(ask.getAttribute("aria-current")).toBe("page");
  });

  it("shows no banner while online", () => {
    render(<AppShell>x</AppShell>);
    expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();
  });

  it("shows the offline banner when the browser is offline", () => {
    setOnline(false);
    render(<AppShell>x</AppShell>);
    expect(screen.getByText(OFFLINE_TEXT)).toBeTruthy();
  });

  it("says on 問問看 that asking needs a connection but saved chat can be read", () => {
    setOnline(false);
    for (const path of ["/ask", "/ask/anything"]) {
      pathname.value = path;
      const { unmount } = render(<AppShell>x</AppShell>);
      expect(screen.getByText(OFFLINE_ASK_TEXT), path).toBeTruthy();
      expect(screen.queryByText(OFFLINE_TEXT), path).toBeNull();
      unmount();
    }
  });

  it("keeps the generic offline line on every other route", () => {
    setOnline(false);
    for (const path of ["/", "/sectors", "/plan", "/glossary", "/settings", "/asking"]) {
      pathname.value = path;
      const { unmount } = render(<AppShell>x</AppShell>);
      expect(screen.getByText(OFFLINE_TEXT), path).toBeTruthy();
      expect(screen.queryByText(OFFLINE_ASK_TEXT), path).toBeNull();
      unmount();
    }
  });

  it("renders the install notice under the header and above the offline line", () => {
    install.mode = "prompt";
    setOnline(false);
    render(<AppShell>x</AppShell>);
    const header = screen.getByRole("banner");
    const notice = screen.getByRole("button", { name: "先不要" }).closest('[role="status"]');
    const offline = screen.getByText(OFFLINE_TEXT);
    const main = screen.getByRole("main");
    expect(notice).toBeTruthy();
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(header, notice as Node)).toBe(true);
    expect(follows(notice as Node, offline)).toBe(true);
    expect(follows(offline, main)).toBe(true);
  });

  it("shows no install notice when the app cannot be installed", () => {
    render(<AppShell>x</AppShell>);
    expect(screen.queryByRole("button", { name: "先不要" })).toBeNull();
  });
});
