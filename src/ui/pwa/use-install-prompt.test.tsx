import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakePromptEvent = Event & {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function promptEvent(outcome: "accepted" | "dismissed" = "accepted"): FakePromptEvent {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as FakePromptEvent;
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  return event;
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IOS_CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";

function setNavigator(props: {
  userAgent?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(window.navigator, key, { configurable: true, value });
  }
}

function setStandaloneDisplayMode(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query === "(display-mode: standalone)",
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

/** Fresh module state per test: the capture store lives at module level. */
async function loadHook() {
  vi.resetModules();
  const { useInstallPrompt } = await import("@/ui/pwa/use-install-prompt");
  return useInstallPrompt;
}

beforeEach(() => {
  setNavigator({ userAgent: DESKTOP_CHROME_UA, maxTouchPoints: 0 });
});

afterEach(() => {
  for (const key of ["userAgent", "maxTouchPoints", "standalone"]) {
    Reflect.deleteProperty(window.navigator, key);
  }
  window.matchMedia = originalMatchMedia;
  vi.resetModules();
});

describe("useInstallPrompt", () => {
  it("is none on desktop Chrome with no event", async () => {
    const useInstallPrompt = await loadHook();
    expect(renderHook(() => useInstallPrompt()).result.current.mode).toBe("none");
  });

  it("replays an event that fired before the hook mounted, and prevents the default mini-bar", async () => {
    const useInstallPrompt = await loadHook();
    const event = promptEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe("prompt");
  });

  it("switches to prompt when the event fires after mount", async () => {
    const useInstallPrompt = await loadHook();
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe("none");
    act(() => {
      window.dispatchEvent(promptEvent());
    });
    expect(result.current.mode).toBe("prompt");
  });

  it("install() prompts once, resolves with the choice and discards the event", async () => {
    const useInstallPrompt = await loadHook();
    const event = promptEvent("accepted");
    window.dispatchEvent(event);
    const { result } = renderHook(() => useInstallPrompt());

    let first: string | undefined;
    await act(async () => {
      first = await result.current.install();
    });
    expect(first).toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe("none");

    let second: string | undefined;
    await act(async () => {
      second = await result.current.install();
    });
    expect(second).toBe("unavailable");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("resolves dismissed when the user declines the native dialog", async () => {
    const useInstallPrompt = await loadHook();
    window.dispatchEvent(promptEvent("dismissed"));
    const { result } = renderHook(() => useInstallPrompt());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.install();
    });
    expect(outcome).toBe("dismissed");
  });

  it("two quick calls prompt only once", async () => {
    const useInstallPrompt = await loadHook();
    const event = promptEvent();
    window.dispatchEvent(event);
    const { result } = renderHook(() => useInstallPrompt());
    let outcomes: string[] = [];
    await act(async () => {
      outcomes = await Promise.all([result.current.install(), result.current.install()]);
    });
    expect(outcomes.sort()).toEqual(["accepted", "unavailable"]);
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("is unavailable when prompt() throws", async () => {
    const useInstallPrompt = await loadHook();
    const event = promptEvent();
    event.prompt.mockRejectedValue(new Error("not allowed"));
    window.dispatchEvent(event);
    const { result } = renderHook(() => useInstallPrompt());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.install();
    });
    expect(outcome).toBe("unavailable");
  });

  it("install() without an event is unavailable", async () => {
    const useInstallPrompt = await loadHook();
    const { result } = renderHook(() => useInstallPrompt());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.install();
    });
    expect(outcome).toBe("unavailable");
  });

  it("becomes installed on appinstalled", async () => {
    const useInstallPrompt = await loadHook();
    window.dispatchEvent(promptEvent());
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe("prompt");
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.mode).toBe("installed");
  });

  it("is installed in standalone display mode, even with an event", async () => {
    setStandaloneDisplayMode(true);
    const useInstallPrompt = await loadHook();
    window.dispatchEvent(promptEvent());
    expect(renderHook(() => useInstallPrompt()).result.current.mode).toBe("installed");
  });

  it("is installed when navigator.standalone is true (iOS home screen app)", async () => {
    setNavigator({ userAgent: IPHONE_UA, maxTouchPoints: 5, standalone: true });
    const useInstallPrompt = await loadHook();
    expect(renderHook(() => useInstallPrompt()).result.current.mode).toBe("installed");
  });

  it("is ios on iPhone Safari that is not standalone", async () => {
    setNavigator({ userAgent: IPHONE_UA, maxTouchPoints: 5, standalone: false });
    const useInstallPrompt = await loadHook();
    expect(renderHook(() => useInstallPrompt()).result.current.mode).toBe("ios");
  });

  it("is ios on an iPad that reports itself as a Mac (touch points above 1)", async () => {
    setNavigator({ userAgent: MAC_SAFARI_UA, maxTouchPoints: 5 });
    const useInstallPrompt = await loadHook();
    expect(renderHook(() => useInstallPrompt()).result.current.mode).toBe("ios");
  });

  it("is none on desktop Safari (a Mac without touch)", async () => {
    setNavigator({ userAgent: MAC_SAFARI_UA, maxTouchPoints: 0 });
    const useInstallPrompt = await loadHook();
    expect(renderHook(() => useInstallPrompt()).result.current.mode).toBe("none");
  });

  it("is installed on iOS Safari running in standalone display mode", async () => {
    setNavigator({ userAgent: IPHONE_UA, maxTouchPoints: 5 });
    setStandaloneDisplayMode(true);
    const useInstallPrompt = await loadHook();
    expect(renderHook(() => useInstallPrompt()).result.current.mode).toBe("installed");
  });

  it("does not show the Safari how-to in another iOS browser", async () => {
    setNavigator({ userAgent: IOS_CHROME_UA, maxTouchPoints: 5 });
    const useInstallPrompt = await loadHook();
    expect(renderHook(() => useInstallPrompt()).result.current.mode).toBe("none");
  });

  it("prefers the captured event over the iOS how-to", async () => {
    setNavigator({ userAgent: IPHONE_UA, maxTouchPoints: 5 });
    const useInstallPrompt = await loadHook();
    window.dispatchEvent(promptEvent());
    expect(renderHook(() => useInstallPrompt()).result.current.mode).toBe("prompt");
  });

  it("registers its listeners once at import, not once per mounted hook", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const useInstallPrompt = await loadHook();
    const count = (name: string) => add.mock.calls.filter(([n]) => String(n) === name).length;
    expect(count("beforeinstallprompt")).toBe(1);
    expect(count("appinstalled")).toBe(1);
    renderHook(() => useInstallPrompt()).unmount();
    renderHook(() => useInstallPrompt()).unmount();
    expect(count("beforeinstallprompt")).toBe(1);
    expect(count("appinstalled")).toBe(1);
    add.mockRestore();
  });
});
