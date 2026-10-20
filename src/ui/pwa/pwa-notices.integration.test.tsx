import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INSTALL_DISMISSED_KEY } from "@/ui/pwa/install";

// No mocks here: the real hook and the real module-level capture store.

type FakePromptEvent = Event & {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function promptEvent(outcome: "accepted" | "dismissed"): FakePromptEvent {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as FakePromptEvent;
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  return event;
}

async function load() {
  vi.resetModules();
  const { PwaNotices } = await import("@/ui/pwa/pwa-notices");
  const { useInstallPrompt } = await import("@/ui/pwa/use-install-prompt");
  const install = await import("@/ui/pwa/install");
  return { PwaNotices: PwaNotices as ComponentType, useInstallPrompt, install };
}

afterEach(() => {
  window.localStorage.clear();
  vi.doUnmock("@/ui/pwa/install");
  vi.resetModules();
});

describe("PwaNotices with the real install hook", () => {
  it("shows the notice for a captured event and prompts once on 安裝", async () => {
    const { PwaNotices } = await load();
    const event = promptEvent("accepted");
    window.dispatchEvent(event);
    render(<PwaNotices />);
    await userEvent.click(screen.getByRole("button", { name: "安裝" }));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    // Accepted: nothing is stored.
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBeNull();
  });

  it("a native decline stores the 30 day dismissal and stays hidden when the event re-fires", async () => {
    const { PwaNotices } = await load();
    const event = promptEvent("dismissed");
    window.dispatchEvent(event);
    render(<PwaNotices />);
    await userEvent.click(screen.getByRole("button", { name: "安裝" }));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).toBeNull();
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toMatch(/^\d+$/);

    act(() => {
      window.dispatchEvent(promptEvent("accepted"));
    });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a native decline from the Settings row is stored too, so the shell notice stays away after a reload", async () => {
    vi.resetModules();
    vi.doMock("@/ui/data/ask-auth", () => ({ deleteAskSession: vi.fn() }));
    const { SettingsProvider } = await import("@/ui/device/settings-provider");
    const { SettingsScreen } = await import("@/ui/settings/settings-screen");
    const event = promptEvent("dismissed");
    window.dispatchEvent(event);
    const first = render(
      <SettingsProvider>
        <SettingsScreen />
      </SettingsProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "安裝" }));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toMatch(/^\d+$/);
    first.unmount();
    vi.doUnmock("@/ui/data/ask-auth");

    // A reload: fresh module state, storage survives, Chrome fires the event again.
    const { PwaNotices } = await load();
    act(() => {
      window.dispatchEvent(promptEvent("accepted"));
    });
    const { container } = render(<PwaNotices />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing on the server, even with an event already captured", async () => {
    const { PwaNotices, useInstallPrompt } = await load();
    window.dispatchEvent(promptEvent("accepted"));
    const html = renderToString(<PwaNotices />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("主畫面");
    function Mode() {
      return <>{useInstallPrompt().mode}</>;
    }
    expect(renderToString(<Mode />)).toBe("none");
  });
});

describe("install store subscriptions", () => {
  it("stops notifying a subscriber after it unsubscribes", async () => {
    const { install } = await load();
    const onChange = vi.fn();
    const unsubscribe = install.subscribeInstall(onChange);
    window.dispatchEvent(promptEvent("accepted"));
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    window.dispatchEvent(promptEvent("accepted"));
    window.dispatchEvent(new Event("appinstalled"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("unmounting the hook removes its subscription", async () => {
    vi.resetModules();
    let active = 0;
    vi.doMock("@/ui/pwa/install", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/ui/pwa/install")>();
      return {
        ...actual,
        subscribeInstall: (onChange: () => void) => {
          active += 1;
          const unsubscribe = actual.subscribeInstall(onChange);
          return () => {
            active -= 1;
            unsubscribe();
          };
        },
      };
    });
    const { useInstallPrompt } = await import("@/ui/pwa/use-install-prompt");
    const hook = renderHook(() => useInstallPrompt());
    expect(active).toBe(1);
    hook.unmount();
    expect(active).toBe(0);
    vi.doUnmock("@/ui/pwa/install");
  });
});
