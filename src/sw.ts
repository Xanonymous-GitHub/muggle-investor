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
  isStorablePage,
  OBSOLETE_CACHES,
  pageCacheKey,
  shouldKeepPageEntry,
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
          { cacheKeyWillBeUsed: ({ request }) => pageCacheKey(new URL(request.url)) },
          { cacheWillUpdate: ({ response }) => (isStorablePage(response) ? response : null) },
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

// Refetch every shell route for this build, bypassing the HTTP cache. All or nothing: if any
// fails, drop the cache, since pages from an older build point at assets this build's precache
// deletes. A page that fails now is cached on its next online visit instead.
async function cacheAppShell(): Promise<void> {
  try {
    const pages = await Promise.all(
      APP_SHELL_ROUTES.map(async (route) => ({
        route,
        response: await fetch(new Request(route, { cache: "reload" })),
      })),
    );
    if (!pages.every(({ response }) => isStorablePage(response))) {
      throw new Error("a shell route did not return a plain 200");
    }
    const cache = await caches.open(PAGES_CACHE);
    await Promise.all(pages.map(({ route, response }) => cache.put(route, response)));
  } catch (error) {
    console.warn("Service worker could not cache the app shell", error);
    try {
      await caches.delete(PAGES_CACHE);
    } catch (deleteError) {
      console.warn("Service worker could not drop the app shell cache", deleteError);
    }
  }
}

// Keep only the shell routes the install step refreshed, and drop caches earlier workers used.
// Never rejects: a failed prune only leaves extra entries, and must not fail activation.
async function pruneCaches(): Promise<void> {
  try {
    await Promise.all(OBSOLETE_CACHES.map((name) => caches.delete(name)));
    const cache = await caches.open(PAGES_CACHE);
    const stale = (await cache.keys()).filter(
      (request) => !shouldKeepPageEntry(new URL(request.url)),
    );
    await Promise.all(stale.map((request) => cache.delete(request)));
  } catch (error) {
    console.warn("Service worker could not prune its caches", error);
  }
}

self.addEventListener("install", (event) => event.waitUntil(cacheAppShell()));
self.addEventListener("activate", (event) => event.waitUntil(pruneCaches()));

serwist.addEventListeners();
