/// <reference lib="webworker" />
import { defaultCache } from "@serwist/vite/worker";
import {
  NetworkFirst,
  NetworkOnly,
  type PrecacheEntry,
  Serwist,
  type SerwistGlobalConfig,
} from "serwist";
import {
  APP_SHELL_ROUTES,
  APP_SHELL_URL,
  isApiRequest,
  isNavigationFallbackCandidate,
} from "@/sw-routes";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const PAGES_CACHE = "pages";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // First match wins, so these rules take precedence over `defaultCache`.
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        isNavigationFallbackCandidate(request, url, self.location.origin),
      handler: new NetworkFirst({
        cacheName: PAGES_CACHE,
        networkTimeoutSeconds: 3,
        plugins: [
          {
            // Neither network nor cache had this page: serve the app shell.
            handlerDidError: async () => (await caches.open(PAGES_CACHE)).match(APP_SHELL_URL),
          },
        ],
      }),
    },
    // The app caches API data itself and decides when to show it as stale.
    { matcher: ({ url }) => isApiRequest(url, self.location.origin), handler: new NetworkOnly() },
    ...defaultCache,
  ],
});

// Best effort: a page that fails to load now is cached on its next online visit instead.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES_CACHE)
      .then((cache) => cache.addAll([...APP_SHELL_ROUTES]))
      .catch((error: unknown) =>
        console.warn("Service worker could not cache the app shell", error),
      ),
  );
});

serwist.addEventListeners();
