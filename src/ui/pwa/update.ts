// Update-prompt plumbing. `src/sw.ts` uses skipWaiting + clientsClaim, so a new worker takes
// over the open page at once and the page sees `controllerchange`. Whether that is an update
// (the page already had a worker) or the very first install is decided by whether a controller
// existed when this module was first evaluated, so it is captured here at module load and
// not when a component mounts. A reload evaluates the module again, which clears the notice.

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function serviceWorkerContainer(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker ?? null;
}

let updateReady = false;
let registration: ServiceWorkerRegistration | null = null;
let lastCheckAt: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

const container = serviceWorkerContainer();
if (container !== null) {
  const hadController = container.controller != null;
  container.addEventListener("controllerchange", () => {
    // Without a controller at load this is the first install taking control: nothing to update.
    if (!hadController || updateReady) return;
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
 * Asks the browser to look for a new worker. At most once per hour, a no-op until a
 * registration has been published, and never rejects (offline is the normal failure).
 */
export async function checkForUpdate(now: number = Date.now()): Promise<void> {
  if (registration === null) return;
  if (lastCheckAt !== null && now - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
  lastCheckAt = now;
  try {
    await registration.update();
  } catch {
    // Offline or a transient network error: the next visible return after an hour tries again.
  }
}

/** The user's choice; never called automatically so a streaming answer or draft is not lost. */
export function reloadPage(): void {
  window.location.reload();
}
