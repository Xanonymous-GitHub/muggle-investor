import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/ui/shell/app-shell";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

const OFFLINE_TEXT = "目前離線，顯示的是上次載入的資料。";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

afterEach(() => {
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
});
