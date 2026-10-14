import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CACHE_VERSION, readCache, writeCache } from "@/ui/data/resource-cache";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { ErrorScreen } from "@/ui/shell/error-screen";
import AppError from "../../../app/(app)/error";

afterEach(() => {
  window.localStorage.clear();
});

describe("ErrorScreen", () => {
  it("says something went wrong and offers a reload", () => {
    render(<ErrorScreen reset={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("畫面出了點問題。");
    expect(screen.getByRole("button", { name: "重新載入" })).toBeTruthy();
  });

  it("clears the cached responses before it resets, so a bad cached body cannot loop", async () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"lens":"pro","theme":"dark"}');
    writeCache("/api/today", {
      v: CACHE_VERSION,
      savedAt: "2026-10-08T10:00:00.000Z",
      dataDate: null,
      body: null,
    });
    let cachedAtReset: unknown = "not called";
    const reset = vi.fn(() => {
      cachedAtReset = readCache("/api/today");
    });
    render(<ErrorScreen reset={reset} />);
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(cachedAtReset).toBeNull();
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe('{"lens":"pro","theme":"dark"}');
  });

  it("is what the app's error boundary renders", () => {
    render(<AppError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("button", { name: "重新載入" })).toBeTruthy();
  });
});
