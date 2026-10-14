// Pure request predicates for the service worker (src/sw.ts), kept apart so they can be tested in Node.

/** The document served for a navigation that is neither reachable nor cached. */
export const APP_SHELL_URL = "/";

/**
 * Top-level pages cached when the service worker installs. The page that registered the worker
 * loaded before the worker controlled it, and client-side navigations fetch RSC payloads rather
 * than documents, so without this a page might never be in the cache when the user goes offline.
 */
export const APP_SHELL_ROUTES = ["/", "/sectors", "/glossary", "/settings"] as const;

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
