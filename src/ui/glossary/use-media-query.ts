"use client";

import { useEffect, useState } from "react";

/**
 * Whether the media query matches. False on the server and on the first client render so
 * hydration agrees; the real answer arrives in an effect, which then follows `change` events.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
