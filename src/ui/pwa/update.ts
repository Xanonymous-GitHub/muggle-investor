// Update-prompt plumbing. `src/sw.ts` uses skipWaiting + clientsClaim, so a new worker takes
// over the open page at once and the page sees `controllerchange`. Whether that is an update
// (a worker was already in control) or a first worker claiming the page is decided by the
// PREVIOUS controller: it is read when this module is first evaluated (not when a component
// mounts) and advanced on every change. A tab opened before any worker existed therefore
// ignores the first change and prompts on the second. A reload evaluates the module again,
// which clears the notice.

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function serviceWorkerContainer(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker ?? null;
}

let updateReady = false;
let registration: ServiceWorkerRegistration | null = null;
let lastCheckAt: number | null = null;
let checking = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

const container = serviceWorkerContainer();
if (container !== null) {
  let previous = container.controller;
  container.addEventListener("controllerchange", () => {
    const was = previous;
    previous = container.controller;
    // No previous controller: the first worker claiming the page, nothing to update.
    if (was == null || updateReady) return;
    updateReady = true;
    emit();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
}

export function subscribeUpdate(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getUpdateReady(): boolean {
  return updateReady;
}

/** Called by the registration component once `register()` has resolved (production only). */
export function publishRegistration(reg: ServiceWorkerRegistration): void {
  registration = reg;
}

/**
 * Asks the browser to look for a new worker. At most once per hour after a successful check,
 * a no-op until a registration has been published, and never rejects. A failure (offline is
 * the normal one) does not use up the hour, so the next visible return tries again.
 */
export async function checkForUpdate(now: number = Date.now()): Promise<void> {
  if (registration === null || checking) return;
  if (lastCheckAt !== null && now - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
  checking = true;
  try {
    await registration.update();
    lastCheckAt = now;
  } catch {
    // Offline or a transient network error: lastCheckAt stays, so the next try is allowed.
  } finally {
    checking = false;
  }
}

/** The user's choice; never called automatically so a streaming answer or draft is not lost. */
export function reloadPage(): void {
  window.location.reload();
}
