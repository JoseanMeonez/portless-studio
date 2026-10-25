import { useCallback, useState } from "react";

/**
 * A true/false choice remembered in this browser under `key`, like whether a section is open.
 * Storage can be missing or blocked (private windows), so every access is guarded and the
 * fallback is `initial`.
 */
export function useStoredFlag(key: string, initial: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => readFlag(key, initial));
  const toggle = useCallback(() => {
    setValue((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Not remembered, but still applied for this visit.
      }
      return next;
    });
  }, [key]);
  return [value, toggle];
}

function readFlag(key: string, initial: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === "1";
  } catch {
    return initial;
  }
}
