import { useEffect, useState } from "react";

/**
 * Whether the page matches a media query, kept current. Where `matchMedia` is missing (tests,
 * old browsers) it answers `fallback`.
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  const [matches, setMatches] = useState(() => read(query, fallback));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

function read(query: string, fallback: boolean): boolean {
  return typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback;
}
