import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

async function loadStore() {
  vi.resetModules();
  return import("@/ui/pwa/update");
}

function fakeRegistration(update: () => Promise<void> = async () => {}) {
  const reg = { update: vi.fn(update) };
  return { reg, asRegistration: reg as unknown as ServiceWorkerRegistration };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: Object.assign(new EventTarget(), { controller: {} }),
  });
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, "serviceWorker");
  Reflect.deleteProperty(document, "visibilityState");
  vi.resetModules();
});

describe("checkForUpdate", () => {
  it("is a no-op until a registration has been published", async () => {
    const { checkForUpdate } = await loadStore();
    await expect(checkForUpdate(NOW)).resolves.toBeUndefined();
  });

  it("calls registration.update() once, then at most once per hour", async () => {
    const { checkForUpdate, publishRegistration } = await loadStore();
    const { reg, asRegistration } = fakeRegistration();
    publishRegistration(asRegistration);
    await checkForUpdate(NOW);
    await checkForUpdate(NOW + 1000);
    await checkForUpdate(NOW + HOUR - 1);
    expect(reg.update).toHaveBeenCalledTimes(1);
    await checkForUpdate(NOW + HOUR);
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it("does not start a second check while one is still running", async () => {
    const { checkForUpdate, publishRegistration } = await loadStore();
    const { reg, asRegistration } = fakeRegistration(() => new Promise(() => {}));
    publishRegistration(asRegistration);
    void checkForUpdate(NOW);
    void checkForUpdate(NOW);
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("swallows a rejected update()", async () => {
    const { checkForUpdate, publishRegistration } = await loadStore();
    const { reg, asRegistration } = fakeRegistration(async () => {
      throw new Error("offline");
    });
    publishRegistration(asRegistration);
    await expect(checkForUpdate(NOW)).resolves.toBeUndefined();
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("swallows a synchronous throw from update()", async () => {
    const { checkForUpdate, publishRegistration } = await loadStore();
    const reg = {
      update: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    publishRegistration(reg as unknown as ServiceWorkerRegistration);
    await expect(checkForUpdate(NOW)).resolves.toBeUndefined();
  });

  it("defaults to the current time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const { checkForUpdate, publishRegistration } = await loadStore();
    const { reg, asRegistration } = fakeRegistration();
    publishRegistration(asRegistration);
    await checkForUpdate();
    await checkForUpdate();
    expect(reg.update).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("visibilitychange", () => {
  it("checks when the tab becomes visible, not when it is hidden, once per hour", async () => {
    const { publishRegistration } = await loadStore();
    const { reg, asRegistration } = fakeRegistration();
    publishRegistration(asRegistration);
    setVisibility("hidden");
    expect(reg.update).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(reg.update).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    setVisibility("visible");
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("does nothing before a registration is published", async () => {
    await loadStore();
    expect(() => setVisibility("visible")).not.toThrow();
  });
});

describe("without navigator.serviceWorker", () => {
  it("loads, subscribes and checks without throwing", async () => {
    Reflect.deleteProperty(window.navigator, "serviceWorker");
    const store = await loadStore();
    const unsubscribe = store.subscribeUpdate(() => {});
    expect(store.getUpdateReady()).toBe(false);
    expect(() => unsubscribe()).not.toThrow();
    await expect(store.checkForUpdate(NOW)).resolves.toBeUndefined();
  });
});
