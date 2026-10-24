export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "portless-studio:theme";

// Storage can throw (private windows, blocked site data); the theme then just follows the system.
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Not persisting is fine: the choice still applies to this tab.
  }
}
