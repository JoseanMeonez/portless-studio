import { useCallback, useEffect, useState } from "react";
import {
  readThemePreference,
  type ThemePreference,
  writeThemePreference,
} from "../shared/lib/theme-storage.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

/**
 * The theme on screen. It follows the system until the person toggles it; the toggle is saved and
 * applied as `data-theme` on <html>, which tokens.css reads.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", preference);
  }, [preference]);

  const theme: "light" | "dark" =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    // Picking what the system already shows means "follow the system" again.
    const nextPreference: ThemePreference = (next === "dark") === systemDark ? "system" : next;
    setPreference(nextPreference);
    writeThemePreference(nextPreference);
  }, [theme, systemDark]);

  return { theme, toggleTheme };
}
