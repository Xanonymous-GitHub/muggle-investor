// Pure request predicates for the service worker (src/sw.ts), kept apart so they can be tested in Node.

/** The document served for a navigation that is neither reachable nor cached. */
export const APP_SHELL_URL = "/";

/**
 * Top-level pages cached when the service worker installs. The page that registered the worker
 * loaded before the worker controlled it, and client-side navigations fetch RSC payloads rather
 * than documents, so without this a page might never be in the cache when the user goes offline.
 */
export const APP_SHELL_ROUTES = ["/", "/sectors", "/plan", "/glossary", "/settings"] as const;

interface RequestLike {
  mode: string;
  destination: string;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** A same-origin document navigation outside `/api/`: served NetworkFirst from the `pages` cache. */
export function isNavigationFallbackCandidate(
  request: RequestLike,
  url: URL,
  origin: string,
): boolean {
  return (
    request.mode === "navigate" &&
    request.destination === "document" &&
    url.origin === origin &&
    !isApiPath(url.pathname)
  );
}

/** A same-origin `/api/` request: never cached by the worker; the app owns data caching. */
export function isApiRequest(url: URL, origin: string): boolean {
  return url.origin === origin && isApiPath(url.pathname);
}

/** Caches earlier workers filled that this one no longer uses (`defaultCache` used to store API GETs). */
export const OBSOLETE_CACHES = ["apis"] as const;

/**
 * The `pages` cache key for a document url: origin and path only. The query string is client
 * state (e.g. `/sectors?group=…` set by `history.pushState`), so an offline reload of such a url
 * must find the page cached under its path.
 */
export function pageCacheKey(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/**
 * Whether a `pages` entry survives a worker update: the shell routes, which the install step
 * just refetched for the new build. Anything else may be HTML from an older build whose hashed
 * assets the new precache has deleted.
 */
export function shouldKeepPageEntry(url: URL): boolean {
  return url.search === "" && (APP_SHELL_ROUTES as readonly string[]).includes(url.pathname);
}

/**
 * A response worth keeping as a page: a plain 200. Redirected responses are refused because
 * Chrome will not serve a redirected response to a navigation from a service worker.
 */
export function isStorablePage(response: { status: number; redirected: boolean }): boolean {
  return response.status === 200 && !response.redirected;
}
