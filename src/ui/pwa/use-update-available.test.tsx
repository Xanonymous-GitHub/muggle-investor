import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `navigator.serviceWorker` stand-in: an EventTarget with a `controller`. */
class FakeServiceWorkerContainer extends EventTarget {
  controller: object | null;
  constructor(controller: object | null) {
    super();
    this.controller = controller;
  }
}

function installServiceWorker(controller: object | null): FakeServiceWorkerContainer {
  const container = new FakeServiceWorkerContainer(controller);
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: container,
  });
  return container;
}

/** Fresh module state per test: "had a controller at load" is captured at module evaluation. */
async function loadHook() {
  vi.resetModules();
  const { useUpdateAvailable } = await import("@/ui/pwa/use-update-available");
  return useUpdateAvailable;
}

const reloadSpy = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  reloadSpy.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, reload: reloadSpy },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, "serviceWorker");
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  vi.resetModules();
});

describe("useUpdateAvailable", () => {
  it("is not ready before any controller change", async () => {
    installServiceWorker({});
    const useUpdateAvailable = await loadHook();
    expect(renderHook(() => useUpdateAvailable()).result.current.ready).toBe(false);
  });

  it("becomes ready on controllerchange when the page already had a controller", async () => {
    const sw = installServiceWorker({});
    const useUpdateAvailable = await loadHook();
    const { result } = renderHook(() => useUpdateAvailable());
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(result.current.ready).toBe(true);
  });

  it("stays ready for a hook that mounts after the change", async () => {
    const sw = installServiceWorker({});
    const useUpdateAvailable = await loadHook();
    sw.dispatchEvent(new Event("controllerchange"));
    expect(renderHook(() => useUpdateAvailable()).result.current.ready).toBe(true);
  });

  it("captures the controller when the module loads, not when the hook mounts", async () => {
    const sw = installServiceWorker({});
    const useUpdateAvailable = await loadHook();
    // The controller disappears (or arrives) between module load and mount: load time decides.
    sw.controller = null;
    const { result } = renderHook(() => useUpdateAvailable());
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(result.current.ready).toBe(true);
  });

  it("does not prompt on the first-ever install (no controller at load)", async () => {
    const sw = installServiceWorker(null);
    const useUpdateAvailable = await loadHook();
    const { result } = renderHook(() => useUpdateAvailable());
    act(() => {
      sw.controller = {};
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(result.current.ready).toBe(false);
  });

  it("prompts on the second controllerchange after a first-ever install", async () => {
    // A tab opened before any worker existed, or after a hard reload: the first change is the
    // first worker claiming the page, the second is a real update.
    const sw = installServiceWorker(null);
    const useUpdateAvailable = await loadHook();
    const { result } = renderHook(() => useUpdateAvailable());
    act(() => {
      sw.controller = {};
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(result.current.ready).toBe(false);
    act(() => {
      sw.controller = {};
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(result.current.ready).toBe(true);
  });

  it("latches: further controller changes keep it ready and notify once", async () => {
    const sw = installServiceWorker({});
    const useUpdateAvailable = await loadHook();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useUpdateAvailable();
    });
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
    });
    const after = renders;
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(result.current.ready).toBe(true);
    expect(renders).toBe(after);
  });

  it("a mount after the first install does not read the new controller as an update", async () => {
    const sw = installServiceWorker(null);
    const useUpdateAvailable = await loadHook();
    sw.controller = {};
    const { result } = renderHook(() => useUpdateAvailable());
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(result.current.ready).toBe(false);
  });

  it("is cleared by a reload (fresh module, controller present, no change event)", async () => {
    const sw = installServiceWorker({});
    let useUpdateAvailable = await loadHook();
    sw.dispatchEvent(new Event("controllerchange"));
    expect(renderHook(() => useUpdateAvailable()).result.current.ready).toBe(true);
    useUpdateAvailable = await loadHook();
    expect(renderHook(() => useUpdateAvailable()).result.current.ready).toBe(false);
  });

  it("reload() calls location.reload once and never reloads by itself", async () => {
    const sw = installServiceWorker({});
    const useUpdateAvailable = await loadHook();
    const { result } = renderHook(() => useUpdateAvailable());
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(reloadSpy).not.toHaveBeenCalled();
    act(() => {
      result.current.reload();
    });
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes from the store on unmount", async () => {
    installServiceWorker({});
    vi.resetModules();
    let subscribed = 0;
    vi.doMock("@/ui/pwa/update", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/ui/pwa/update")>();
      return {
        ...actual,
        subscribeUpdate: (onChange: () => void) => {
          const unsubscribe = actual.subscribeUpdate(onChange);
          subscribed += 1;
          return () => {
            subscribed -= 1;
            unsubscribe();
          };
        },
      };
    });
    const { useUpdateAvailable } = await import("@/ui/pwa/use-update-available");
    const { unmount } = renderHook(() => useUpdateAvailable());
    expect(subscribed).toBe(1);
    unmount();
    expect(subscribed).toBe(0);
    vi.doUnmock("@/ui/pwa/update");
  });

  it("is inert without navigator.serviceWorker", async () => {
    Reflect.deleteProperty(window.navigator, "serviceWorker");
    const useUpdateAvailable = await loadHook();
    const { result } = renderHook(() => useUpdateAvailable());
    expect(result.current.ready).toBe(false);
    expect(() => result.current.reload()).not.toThrow();
  });

  it("renders not-ready on the server even when the client snapshot is ready", async () => {
    const sw = installServiceWorker({});
    const useUpdateAvailable = await loadHook();
    sw.dispatchEvent(new Event("controllerchange"));
    expect(renderHook(() => useUpdateAvailable()).result.current.ready).toBe(true);
    // biome-ignore lint/correctness/noComponentHookFactories: the hook comes from a module re-imported per test (`loadHook()`), so it cannot be bound at module level
    function Probe() {
      return <span>{String(useUpdateAvailable().ready)}</span>;
    }
    expect(renderToString(<Probe />)).toContain("false");
  });
});
