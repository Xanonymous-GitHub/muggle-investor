import { useSyncExternalStore } from "react";

// Same reason as ./next-link.tsx. Tests that care about the path replace this module with
// `vi.mock("next/navigation", ...)`.
export function usePathname(): string {
  return "/";
}

// vinext patches `history.pushState` so `useSearchParams` follows shallow url updates; this stub
// does the same with a plain event, so components that write `?group=` re-render in tests too.
const URL_CHANGE = "test:urlchange";
const originalPushState = window.history.pushState.bind(window.history);
window.history.pushState = (data, unused, url) => {
  originalPushState(data, unused, url);
  window.dispatchEvent(new Event(URL_CHANGE));
};
const originalReplaceState = window.history.replaceState.bind(window.history);
window.history.replaceState = (data, unused, url) => {
  originalReplaceState(data, unused, url);
  window.dispatchEvent(new Event(URL_CHANGE));
};

function subscribe(onChange: () => void): () => void {
  window.addEventListener(URL_CHANGE, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(URL_CHANGE, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  return new URLSearchParams(search);
}
