import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  Reflect.deleteProperty(window.navigator, "serviceWorker");
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function setup(env: "production" | "test") {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env);
  const registration = { update: vi.fn(async () => {}) };
  const register = vi.fn(async () => registration);
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: Object.assign(new EventTarget(), { controller: null, register }),
  });
  const { ServiceWorkerRegistration } = await import("@/components/service-worker-registration");
  const update = await import("@/ui/pwa/update");
  return { ServiceWorkerRegistration, update, register, registration };
}

describe("ServiceWorkerRegistration", () => {
  it("registers in production and publishes the registration to the update store", async () => {
    const { ServiceWorkerRegistration, update, register, registration } = await setup("production");
    render(<ServiceWorkerRegistration />);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    await vi.waitFor(async () => {
      await update.checkForUpdate(0);
      expect(registration.update).toHaveBeenCalledTimes(1);
    });
  });

  it("does not register outside production", async () => {
    const { ServiceWorkerRegistration, register } = await setup("test");
    render(<ServiceWorkerRegistration />);
    expect(register).not.toHaveBeenCalled();
  });
});
